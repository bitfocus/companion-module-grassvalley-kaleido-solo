const { InstanceBase, Regex, runEntrypoint, TelnetHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')

var actions = require('./actions');

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
		debug(data);

		self.status(self.STATUS_OK);
		
		// Process layouts response
		if(self.commandQueue[0] == "<getKLayoutList/>") {
			if(data== "<kLayoutList>") return;
			
			rawList = data.trim().split('"');
			rawList = rawList.filter(ele => (ele.trim() != "" && ele.trim() != "</kLayoutList>"))
			
			self.presetNames = rawList.map(ele => ({"id" : ele, "label": ele}))
			debug(self.presetNames);
			self.actions();
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
				if (this !== self.STATUS_OK) {
					self.updateStatus(status,message)
				}
			});

			self.socket.on('error', function (err) {
				self.log('error',"Network error: " + err.message);
			});

			self.socket.on('connect', function () {
				self.log("Connected");
				
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

	updateActions() {
		this.setActionDefinitions(actions.getActions(this.presetNames));
	};

	queueCommand(command) {
		var self = this;
		
		self.commandQueue.push(command);
		debug("Queued : "+command);
		
		if (self.commandQueue.length == 1) { // If the new command is the only one
			debug("-> Immediate send : " + command);
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
		
		command = self.commandQueue[0]; // Only remove from queue after response from device
		debug("Sending: "+command);
		
		if (self.socket !== undefined && self.socket.connected) {
			self.socket.write(command+"\n");
		} else {
			debug('Socket not connected :(');
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
		
		command = `<setKStatusMessage>set id="${id}" status="${state}"</setKStatusMessage>`;
		this.queueCommand(command);
	}

	alarmCommand(action) {
		state = action.options.state.toUpperCase();
		command = `<setKStatusMessage>set id="0" status="${state}"</setKStatusMessage>`;
		this.queueCommand(command);
	}

	UMDCommand(action) {
		text = action.options.text;
		
		var command;
		this.parseVariables(action.options.text, (value) => {
			command = `<setKDynamicText>set address="0" text="${value}"</setKDynamicText>`;
		})
		
		this.queueCommand(command);
	}

	presetCommand(action) {
		name = action.options.name;
		command = `<setKCurrentLayout>set ${name}</setKCurrentLayout>`;
		this.queueCommand(command);
	}
}

runEntrypoint(KaleidoInstance, UpgradeScripts)