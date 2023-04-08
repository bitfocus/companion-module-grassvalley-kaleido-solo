var instance_skel = require('../../instance_skel');
var TelnetSocket = require('../../telnet');
var actions = require('./actions');
var debug;
var log;

const PORT = 13000;

function instance(system, id, config) {
	var self = this;

	// super-constructor
	instance_skel.apply(this, arguments);
	self.status(1,'Initializing');
	self.actions(); // export actions

	return self;
}

instance.prototype.updateConfig = function(config) {
	var self = this;
	self.config = config;
	self.init_tcp();
};

instance.prototype.incomingData = function(data) {
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

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;
	
	self.commandQueue = [];
	self.presetNames = [];
	self.init_tcp();
};

instance.prototype.init_tcp = function() {
	var self = this;

	if (self.socket !== undefined) {
		self.socket.destroy();
		delete self.socket;
	}

	if (self.config.host) {
		self.socket = new TelnetSocket(self.config.host, PORT);

		self.socket.on('status_change', function (status, message) {
			if (status !== self.STATUS_OK) {
				self.status(status, message);
			}
		});

		self.socket.on('error', function (err) {
			debug("Network error", err);
			self.log('error',"Network error: " + err.message);
		});

		self.socket.on('connect', function () {
			debug("Connected");
			
			// Open session
			self.queueCommand("<openID>" + self.config.host + "_0_4_0_0</openID>");
			
			// Read layout names
			self.queueCommand("<getKLayoutList/>");
		});

		self.socket.on('error', function (err) {
			debug("Network error", err);
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
instance.prototype.config_fields = function () {
	var self = this;

	return [
		{
			type:    'text',
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

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;

	if (self.socket !== undefined) {
		self.socket.write("<closeID/>\n");
		self.socket.destroy();
	}

	debug("destroy", self.id);
};

instance.prototype.actions = function(system) {
	var self = this;
	self.setActions(actions.getActions(self.presetNames));
};

instance.prototype.queueCommand = function(command) {
	var self = this;
	
	self.commandQueue.push(command);
	debug("Queued : "+command);
	
	if (self.commandQueue.length == 1) { // If the new command is the only one
		debug("-> Immediate send : " + command);
		// Send right away
		self.processQueue();
	}
};

instance.prototype.processQueue = function() {
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

instance.prototype.tallyCommand = function(action) {
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
	
	return `<setKStatusMessage>set id="${id}" status="${state}"</setKStatusMessage>`
}

instance.prototype.alarmCommand = function(action) {
	state = action.options.state.toUpperCase();
	
	return `<setKStatusMessage>set id="0" status="${state}"</setKStatusMessage>`
}

instance.prototype.UMDCommand = function(action) {
	text = action.options.text;
	
	var command;
	this.parseVariables(action.options.text, (value) => {
		command = `<setKDynamicText>set address="0" text="${value}"</setKDynamicText>`
	})
	
	return command;
}

instance.prototype.presetCommand = function(action) {
	name = action.options.name;
	return `<setKCurrentLayout>set ${name}</setKCurrentLayout>`
}

instance.prototype.action = function(action) {

	var self = this;
	var id = action.action;
	var command;

	switch (id) {
		case 'tally':
			command = this.tallyCommand(action);
			break;
		case 'alarm':
			command = this.alarmCommand(action);
			break;
		case 'umd':
			command = this.UMDCommand(action);
			break;
		case 'preset':
			command = this.presetCommand(action);
			break;
	}

	if (command !== undefined) {
		self.queueCommand(command);
	}
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;
