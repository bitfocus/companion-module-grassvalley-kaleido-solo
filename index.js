const { InstanceBase, runEntrypoint, TelnetHelper, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')

const xml2js = require('xml2js')

class KaleidoInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)
		this.updateActions() // export actions
		this.initVariables() // export variables

		this.port = 13000

		this.workingBuffer = ''
		this.commandQueue = []
		this.roomNames = []
		this.presetNames = []
		this.init_tcp()
	}

	// When module gets deleted
	async destroy() {
		if (this.socket !== undefined) {
			this.socket.write('<closeID/>\n')
			this.socket.destroy()
		}

		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.config = config
		this.init_tcp()
	}

	parseKeyValueResponse(data) {
		if (data !== undefined) {
			if (data.trim() == '<nack/>') {
				this.log('warn', 'Got NAck for command ' + this.commandQueue[0])
				// Successful parse, clear buffer so we don't try and parse it again
				this.workingBuffer = ''
				return undefined
			} else {
				// <kParameterInfo>softwareVersion="8.40 build 1234"</kParameterInfo>
				const keyValue = /^\s*<([^>]+)>([^=]+)="([^"]*)"<\/([^>]+)>\s*$/
				let matches = data.match(keyValue)

				if (matches !== null && matches.length == 5) {
					// Successful parse, clear buffer so we don't try and parse it again
					this.workingBuffer = ''
					return { key: matches[2], value: matches[3] }
				} else {
					return undefined
				}
			}
		} else {
			return undefined
		}
	}

	// Process data coming from the unit
	incomingData(data) {
		var self = this
		self.log('debug', 'Received: ' + data)
		if (self.workingBuffer != '') {
			self.log('debug', 'Current total buffer is: ' + data)
			self.workingBuffer += data
		} else {
			self.workingBuffer = data
		}

		self.updateStatus(InstanceStatus.Ok)

		// Process layouts response
		if (self.commandQueue[0] == '<getKLayoutList/>') {
			xml2js
				.parseStringPromise(self.workingBuffer)
				.then(function (result) {
					self.log('debug', 'Parsed data: ' + JSON.stringify(result))
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
					if (result.kLayoutList !== undefined) {
						// Deliberately add a space to the end so we can simplify the split
						var rawList = (result.kLayoutList + ' ').split('.kg2 ')
						rawList = rawList.filter((ele) => ele.trim() != '')

						self.log('info', 'Received presets:' + rawList)
						self.presetNames = rawList.map((ele) => ({ id: ele + '.kg2', label: ele }))
						self.updateActions()
					} else {
						self.log('warn', "Didn't get any presets, clearing the current list")
						self.presetNames = []
					}
				})
				.catch(function (err) {
					// Failed to parse
					self.log('warn', 'Failed to parse data, either invalid XML or partial packet data: ' + self.workingBuffer)
				})
		} else if (self.commandQueue[0] == '<getKCurrentLayout/>') {
			// <kCurrentLayout>name="foo.kg2"</kCurrentLayout>
			if (data == '<kCurrentLayout>') return

			// Extract the name...
			let keyValue = self.parseKeyValueResponse(self.workingBuffer)
			if (keyValue !== undefined) {
				// TODO(Peter): Deal with rooms in terms of variable names...
				self.setVariableValues({ current_layout: keyValue.value })
			} else {
				// TODO(Someone): Handle Alto or Quad
			}
		} else if (self.commandQueue[0] == '<getKRoomList/>') {
			xml2js
				.parseStringPromise(data)
				.then(function (result) {
					self.log('debug', 'Parsed data: ' + JSON.stringify(result))
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
					if (result.kRoomList !== undefined && result.kRoomList.room !== undefined) {
						self.roomNames = result.kRoomList.room.map((ele) => ({ id: ele, label: ele }))
					} else {
						self.log('warn', "Didn't get any rooms, clearing the current list")
						self.roomNames = []
					}
				})
				.catch(function (err) {
					// Failed to parse
					self.log('warn', 'Failed to parse data, either invalid XML or partial packet data: ' + self.workingBuffer)
				})
		} else if (
			self.commandQueue[0] == '<getParameterInfo>get key="softwareVersion"</getParameterInfo>' ||
			self.commandQueue[0] == '<getParameterInfo>get key="systemName"</getParameterInfo>'
		) {
			// Handle software version or system name
			const parameterNameMapping = { softwareVersion: 'software_version', systemName: 'system_name' }

			let keyValue = self.parseKeyValueResponse(data)

			if (keyValue !== undefined) {
				let variableName = parameterNameMapping[keyValue.key]
				if (variableName !== undefined) {
					// <kParameterInfo>softwareVersion="1.2 build 3"</kParameterInfo>
					let variables = {}
					variables[variableName] = keyValue.value
					self.setVariableValues(variables)
				}
			} else {
				self.log('warn', 'Failed to parse parameter from: ' + data)
			}
		}

		// Process end of responses
		if (data.includes('/')) {
			// End of response
			self.commandQueue.shift()
			self.processQueue()
		}
	}

	// Set up connection
	init_tcp() {
		var self = this
		if (self.socket !== undefined) {
			self.socket.destroy()
			delete self.socket
		}

		if (self.config.host) {
			self.socket = new TelnetHelper(this.config.host, this.port)

			self.socket.on('status_change', function (status, message) {
				self.log('debug', 'Socket status changed to ' + status)
				self.updateStatus(status)
			})

			self.socket.on('error', function (err) {
				self.log('error', 'Network error: ' + err.message)
			})

			self.socket.on('connect', function () {
				self.log('info', 'Connected')

				// Reset the working buffer each time we connect
				self.workingBuffer = ''

				// Open session
				self.queueCommand(`<openID>${self.config.host}_0_4_0_0</openID>`)

				// Get software version
				self.queueCommand('<getParameterInfo>get key="softwareVersion"</getParameterInfo>')

				// Get system name
				self.queueCommand('<getParameterInfo>get key="systemName"</getParameterInfo>')

				// Get room list
				self.queueCommand('<getKRoomList/>')

				// Read layout names
				self.queueCommand('<getKLayoutList/>')

				// Per room...
				// Read current layout
				//self.queueCommand('<getKCurrentLayout/>')
			})

			self.socket.on('error', function (err) {
				self.log('error', 'Network error: ' + err.message)
			})

			// Process incoming data
			self.socket.on('data', function (buffer) {
				var indata = buffer.toString('utf8')
				self.incomingData(indata)
			})
		}
	}

	// Return config fields for web config
	getConfigFields() {
		var self = this

		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This will establish a TCP connection to a Kaleido multiviewer',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'IP address of the device',
				width: 12,
				default: '127.0.0.1',
				regex: self.REGEX_IP,
			},
		]
	}

	// Add command to queue
	queueCommand(command) {
		var self = this

		self.commandQueue.push(command)
		self.log('debug', 'Queued : ' + command)
		self.log('debug', 'Queue length : ' + self.commandQueue.length)

		if (self.commandQueue.length == 1) {
			// If the new command is the only one
			self.log('debug', '-> Immediate send : ' + command)
			// Send right away
			self.processQueue()
		}
	}

	// Send next command from queue if available
	processQueue() {
		var self = this

		if (self.commandQueue.length == 0) {
			// Currently nothing to send
			return
		}

		var command = self.commandQueue[0] // Only remove from queue after response from device
		self.log('debug', 'Sending: ' + command)

		if (self.socket !== undefined && self.socket.isConnected) {
			self.socket.send(command + '\n')
		} else {
			self.log('error', 'Socket not connected')
		}
	}

	// Generate command for tally state
	tallyCommand(action) {
		var state = ''
		var id = 0

		switch (action.options.color) {
			case 'red':
				id = 1
				break
			case 'green':
				id = 2
				break
		}

		if (action.options.active) {
			state = 'MINOR'
		} else {
			state = 'NORMAL'
		}

		var command = `<setKStatusMessage>set id="${id}" status="${state}"</setKStatusMessage>`
		this.queueCommand(command)
	}

	updateActions() {
		var self = this

		var tallyColors = [
			{
				id: 'green',
				label: 'Green',
			},
			{
				id: 'red',
				label: 'Red',
			},
		]

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
			tally: {
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
					self.tallyCommand(event)
				},
			},
			alarm: {
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
					var state = event.options.state.toUpperCase()
					var command = `<setKStatusMessage>set id="0" status="${state}"</setKStatusMessage>`
					self.queueCommand(command)
				},
			},
			umd: {
				name: 'Set UMD text',
				description: 'Set the text in the UMD bar, including variables.',
				options: [
					{
						type: 'textinput',
						label: 'UMD text',
						id: 'text',
						default: '',
						useVariables: true,
					},
				],
				callback: async (event, context) => {
					const text = await context.parseVariablesInString(event.options.text)
					var command = `<setKDynamicText>set address="0" text="${text}"</setKDynamicText>`
					self.queueCommand(command)
				},
			},
			preset: {
				name: 'Recall preset',
				description: 'Recall one of the presets stored in the device',
				options: [
					{
						type: 'dropdown',
						label: 'Preset name',
						id: 'name',
						choices: self.presetNames,
						default: self.presetNames !== undefined && self.presetNames.length > 0 ? self.presetNames[0].id : '',
					},
				],
				callback: async (event) => {
					var command = `<setKCurrentLayout>set ${event.options.name}</setKCurrentLayout>`
					this.queueCommand(command)
				},
			},
		}

		self.setActionDefinitions(actions)
	}

	initVariables() {
		var variableDefinitions = []

		variableDefinitions.push({
			name: 'Software Version',
			variableId: 'software_version',
		})

		variableDefinitions.push({
			name: 'System Name',
			variableId: 'system_name',
		})

		// TODO(Peter): Add and expose other variables

		this.setVariableDefinitions(variableDefinitions)
	}
}

runEntrypoint(KaleidoInstance, UpgradeScripts)
