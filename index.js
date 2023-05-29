const { InstanceBase, Regex, runEntrypoint, TelnetHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')

class KaleidoInstance extends InstanceBase {
	
	constructor(internal) {
		super(internal)
	}
	
	async init(config) {
		this.config = config

		this.updateStatus('ok')

		this.updateActions() // export actions
		
		this.port = 13000;
		
		this.commandQueue = [];
		this.presetNames = [];
		this.init_tcp();
	}
	// When module gets deleted
	async destroy() {
		if (this.socket !== undefined) {
			this.socket.write("<closeID/>\n");
			this.socket.destroy();
		}
		
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.config = config
		this.init_tcp();
	}

	incomingData(data) {
		var self = this;
		self.log("debug","received: "+data);

		self.updateStatus('ok')
		
		// Process layouts response
		if(self.commandQueue[0] == "<getKLayoutList/>") {
			if(data== "<kLayoutList>") return;
			
			var rawList = data.trim().split('"');
			rawList = rawList.filter(ele => (ele.trim() != "" && ele.trim() != "</kLayoutList>"))
			
			self.log("info","Received presets:" +rawList);
			self.presetNames = rawList.map(ele => ({"id" : ele, "label": ele}))
			self.updateActions();
		}
		
		// Process end of responses
		if(data.includes("/")) {
			// End of response
			self.commandQueue.shift();
			self.processQueue();
		}
	};

	init_tcp() {
		var self = this;
		if (self.socket !== undefined) {
			self.socket.destroy();
			delete self.socket;
		}

		if (self.config.host) {
			self.socket = new TelnetHelper(this.config.host, this.port);

			self.socket.on('status_change', function (status, message) {
				self.log("debug","Socket status changed to"+status+message);
				if (status !== "ok") {
					self.updateStatus(status,message)
				}
			});

			self.socket.on('error', function (err) {
				self.log('error',"Network error: " + err.message);
			});

			self.socket.on('connect', function () {
				self.log("info","Connected");
				
				// Open session
				self.queueCommand("<openID>" + self.config.host + "_0_4_0_0</openID>");
				
				// Read layout names
				self.queueCommand("<getKLayoutList/>");
			});

			self.socket.on('error', function (err) {
				self.log('error',"Network error: " + err.message);
			});

			// Process incoming data
			self.socket.on("data", function(buffer) {
				var indata = buffer.toString("utf8");
				self.incomingData(indata);
			});
		}
	};

	// Return config fields for web config
	getConfigFields() {
		var self = this;

		return [
			{
				type:    'static-text',
				id:      'info',
				width:   12,
				label:   'Information',
				value:   'This will establish a TCP connection to a Kaleido multiviewer'
			},{
				type:    'textinput',
				id:      'host',
				label:   'IP address of the device',
				width:   12,
				default: '127.0.0.1',
				regex:   self.REGEX_IP
			}
		]
	};

	queueCommand(command) {
		var self = this;
		
		self.commandQueue.push(command);
		self.log("debug","Queued : "+command);
		
		if (self.commandQueue.length == 1) { // If the new command is the only one
			self.log("debug","-> Immediate send : " + command);
			// Send right away
			self.processQueue();
		}
	};

	processQueue() {
		var self = this;
		
		if(self.commandQueue.length == 0) {
			// Currently nothing to send
			return;
		}
		
		var command = self.commandQueue[0]; // Only remove from queue after response from device
		self.log("debug","Sending: "+command);
		
		if (self.socket !== undefined && self.socket.isConnected) {
			self.socket.send(command+"\n");
		} else {
			self.log("error","Socket not connected");
		}
	}

	tallyCommand(action) {
		var state = "";
		var id = 0;
		var cmd = "";
		
		switch(action.options.color) {
			case 'red':
				id = 1;
				break;
			case 'green':
				id = 2;
				break;
		}
		
		if(action.options.active) {
			state = "MINOR";
		}
		else {
			state = "NORMAL";
		}
		
		var command = `<setKStatusMessage>set id="${id}" status="${state}"</setKStatusMessage>`;
		this.queueCommand(command);
	}
	
	updateActions() {
		var self = this;
		
		var tallyColors = [
			{
				id: 'green',
				label: 'Green',
			},
			{
				id: 'red',
				label: 'Red',
			},
		];
		
		var alarmStates = [
			{
				id: 'normal',
				label: 'Normal',
			},
			{
				id: 'minor',
				label: 'Minor (yellow)',
			},
			{
				id: 'error',
				label: 'Critical (red)',
			},
		]
		
		
		var actions = {
			'tally': {
				name: 'Set tally',
				description: 'Set tally boxes in UMD',
				options: [
					{
						type: 'dropdown',
						label: 'Color',
						id: 'color',
						default: 'green',
						choices: tallyColors,
					},
					{
						type: 'checkbox',
						label: 'Active',
						id: 'active',
					},
				],
				callback: async (event) => {
					self.tallyCommand(event);
				},
			},
			'alarm': {
				name: 'Set alarm state',
				description: 'Set alarm border',
				options: [
					{
						type: 'dropdown',
						label: 'State',
						id: 'state',
						default: 'normal',
						choices: alarmStates,
					},
				],
				callback: async (event) => {
					var state = event.options.state.toUpperCase();
					var command = `<setKStatusMessage>set id="0" status="${state}"</setKStatusMessage>`;
					self.queueCommand(command);
				},
			},
			'umd': {
				name: 'Set UMD text',
				description: 'Set the text in the UMD bar, including variables.',
				options: [
					{
						type: 'textinput',
						label: 'UMD text',
						tooltip: "Supports variables",
						id: 'text',
						default: '',
					},
				],
				callback: async (event) => {
					const text = await this.parseVariablesInString(event.options.text)
					var command = `<setKDynamicText>set address="0" text="${text}"</setKDynamicText>`;
					self.queueCommand(command);
				},
			},
			'preset': {
				name: 'Recall preset',
				description: 'Recall one of the presets stored in the device',
				options: [
					{
						type: 'dropdown',
						label: 'Preset name',
						id: 'name',
						default: 'USER PRESET 1',
						choices: self.presetNames,
					},
				],
				callback: async (event) => {
					var command = `<setKCurrentLayout>set ${event.options.name}</setKCurrentLayout>`;
					this.queueCommand(command);
				},
			}
		};
		
		self.setActionDefinitions(actions);
	};
	
}

runEntrypoint(KaleidoInstance, UpgradeScripts)