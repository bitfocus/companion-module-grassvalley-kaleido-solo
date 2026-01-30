const { InstanceBase, runEntrypoint, TelnetHelper, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')

const feedbacks = require('./src/feedbacks')
const presets = require('./src/presets')

const xml2js = require('xml2js')

class KaleidoInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		// Assign the methods from the listed files to this class
		Object.assign(this, {
			...feedbacks,
			...presets,
		})

		this.DATA = {
			rooms: [],
		}
	}

	async init(config) {
		this.config = config

		this.port = 13000

		this.workingBuffer = ''
		this.commandQueue = []
		this.context = ''
		this.roomNames = []
		this.presetNames = []

		this.updateActions() // export actions
		this.initFeedbacks() // export feedbacks
		this.initVariables() // export variables

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

	splitLayout(data) {
		if (data !== undefined) {
			var roomDividerLocation = data.indexOf('/')
			if (roomDividerLocation >= 0) {
				return { room: data.substring(0, roomDividerLocation), layout: data.substring(roomDividerLocation + 1) }
			} else {
				return { room: '', layout: data }
			}
		} else {
			return undefined
		}
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
	async incomingData(data) {
		var self = this
		self.log('debug', 'Received: ' + data)
		if (self.workingBuffer != '') {
			self.workingBuffer += data
			self.log('debug', 'Current total buffer is: ' + self.workingBuffer)
		} else {
			self.workingBuffer = data
		}

		if (self.commandQueue.length >= 1) {
			// Process response
			if (self.commandQueue[0] == '<getKLayoutList/>') {
				await xml2js
					.parseStringPromise(self.workingBuffer)
					.then(function (result) {
						self.log('debug', 'Parsed data: ' + JSON.stringify(result))
						// Successful parse, clear buffer so we don't try and parse it again
						self.workingBuffer = ''
						if (result.kLayoutList !== undefined && result.kLayoutList !== '') {
							const findLayoutExtension = /(\.(?:kg2|xml))\s*$/
							let matches = result.kLayoutList.match(findLayoutExtension)

							if (matches !== null && matches.length == 2) {
								// Must be KX Software, K2, Alto or Quad format
								const layoutExtension = matches[1]
								// Deliberately add a space to the end so we can simplify the split
								let rawList = (result.kLayoutList + ' ').split(/\.(?:kg2|xml) /)
								rawList = rawList.filter((ele) => ele.trim() != '')

								self.log('info', 'Received presets:' + rawList)
								self.presetNames = rawList.map((ele) => ({ id: ele + layoutExtension, label: ele }))
							} else {
								// TODO(Someone): Must be Solo format
								let rawList = result.kLayoutList.trim().split('"')
								rawList = rawList.filter((ele) => ele.trim() != '')

								self.log('info', 'Received presets:' + rawList)
								self.presetNames = rawList.map((ele) => ({ id: ele, label: ele }))
							}
							self.updateActions()
						} else {
							self.log('warn', "Didn't get any presets, clearing the current list")
							self.presetNames = []
						}
						self.initPresets()
					})
					.catch(function (err) {
						// Failed to parse
						self.log('warn', 'Failed to parse data, either invalid XML or partial packet data: ' + self.workingBuffer)
					})
			} else if (self.commandQueue[0] == '<getKCurrentLayout/>') {
				// <kCurrentLayout>name="foo.kg2"</kCurrentLayout>
				// <kCurrentLayout>bar.xml</kCurrentLayout>

				// Extract the name...
				let keyValue = self.parseKeyValueResponse(self.workingBuffer)
				if (keyValue !== undefined) {
					let variables = {}
					if (self.context !== undefined && self.context !== '') {
						self.DATA.rooms[self.context] = keyValue.value
						variables[`current_layout_${self.context}`] = keyValue.value
					} else {
						// Assuming no rooms returned...
						self.DATA.rooms[''] = keyValue.value
						variables['current_layout'] = keyValue.value
					}
					self.setVariableValues(variables)
				} else if (self.workingBuffer !== '') {
					// If not yet handled, assume its an Alto or Quad and handle them
					await xml2js
						.parseStringPromise(self.workingBuffer)
						.then(function (result) {
							self.log('debug', 'Parsed data: ' + JSON.stringify(result))
							// Successful parse, clear buffer so we don't try and parse it again
							self.workingBuffer = ''
							if (result.kCurrentLayout !== undefined) {
								self.DATA.rooms[''] = result.kCurrentLayout
								self.setVariableValues({ current_layout: result.kCurrentLayout })
							} else {
								self.log('warn', "Didn't get a current layout, clearing the current layout")
								self.DATA.rooms[''] = undefined
								self.setVariableValues({ current_layout: undefined })
							}
						})
						.catch(function (err) {
							// Failed to parse
							self.log('warn', 'Failed to parse data, either invalid XML or partial packet data: ' + self.workingBuffer)
						})
				}
				self.checkFeedbacks()
			} else if (self.commandQueue[0] == '<getKRoomList/>') {
				if (self.workingBuffer.trim() == '<nack/>') {
					self.log('warn', 'Got NAck for command ' + self.commandQueue[0] + ' in context ' + self.context)
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
					self.log('warn', 'Got NAck when fetching rooms, clearing the current list')
					self.roomNames = []
					self.initVariables()
				} else {
					await xml2js
						.parseStringPromise(self.workingBuffer)
						.then(function (result) {
							self.log('debug', 'Parsed data: ' + JSON.stringify(result))
							// Successful parse, clear buffer so we don't try and parse it again
							self.workingBuffer = ''
							if (result.kRoomList !== undefined && result.kRoomList.room !== undefined) {
								self.roomNames = result.kRoomList.room.map((ele) => ({ id: ele, label: ele }))
								for (const room of result.kRoomList.room) {
									self.queueCommand(`<openID>${room}</openID>`)
									self.queueCommand('<getKCurrentLayout/>')
									self.queueCommand('<closeID/>')
								}
							} else {
								self.log('warn', "Didn't get any rooms, clearing the current list")
								self.roomNames = []
							}
							// Update room variables either way
							self.initVariables()
						})
						.catch(function (err) {
							// Failed to parse
							self.log('warn', 'Failed to parse data, either invalid XML or partial packet data: ' + self.workingBuffer)
						})
				}
			} else if (
				self.commandQueue[0] == '<getParameterInfo>get key="softwareVersion"</getParameterInfo>' ||
				self.commandQueue[0] == '<getParameterInfo>get key="systemName"</getParameterInfo>'
			) {
				// Handle software version or system name
				const parameterNameMapping = { softwareVersion: 'software_version', systemName: 'system_name' }

				let keyValue = self.parseKeyValueResponse(self.workingBuffer)

				if (keyValue !== undefined) {
					let variableName = parameterNameMapping[keyValue.key]
					if (variableName !== undefined) {
						// <kParameterInfo>softwareVersion="1.2 build 3"</kParameterInfo>
						let variables = {}
						variables[variableName] = keyValue.value
						self.setVariableValues(variables)
					} else {
						self.log('warn', "Got parameter but couldn't find a matching variable to store it in " + keyValue.key)
					}
				} else {
					self.log('warn', 'Failed to parse parameter from: ' + self.workingBuffer)
				}
			} else if (
				/^\s*<setKCurrentLayout>set [^<]+<\/setKCurrentLayout>\s*$/.test(self.commandQueue[0]) ||
				/^\s*<setKDynamicText>set [^<]+<\/setKDynamicText>\s*$/.test(self.commandQueue[0]) ||
				/^\s*<setKStatusMessage>set [^<]+<\/setKStatusMessage>\s*$/.test(self.commandQueue[0])
			) {
				if (self.workingBuffer.trim() == '<nack/>') {
					self.updateStatus(
						InstanceStatus.UnknownError,
						'Got NAck for command ' + self.commandQueue[0] + ' in context ' + self.context,
					)
					self.log('warn', 'Got NAck for command ' + self.commandQueue[0] + ' in context ' + self.context)
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
				} else if (self.workingBuffer.trim() == '<ack/>') {
					self.log('info', 'Got Ack for command ' + self.commandQueue[0] + ' in context ' + self.context)
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''

					const setKCurrentLayout = /^\s*<setKCurrentLayout>set ([^<]+)<\/setKCurrentLayout>\s*$/
					let matches = self.commandQueue[0].match(setKCurrentLayout)

					// If setKCurrentLayout, queue a layout poll
					if (matches !== null && matches.length == 2) {
						const layoutParts = self.splitLayout(matches[1])
						if (layoutParts !== undefined && layoutParts.room == '') {
							self.queueCommand('<getKCurrentLayout/>')
						} else {
							self.queueCommand(`<openID>${layoutParts.room}</openID>`)
							self.queueCommand('<getKCurrentLayout/>')
							self.queueCommand('<closeID/>')
						}
					}
				} else {
					self.updateStatus(
						InstanceStatus.UnknownError,
						'Unknown response for command ' + self.commandQueue[0] + ' in context ' + self.context,
					)
					self.log('warn', 'Unknown response for command ' + self.commandQueue[0] + ' in context ' + self.context)
				}
			} else if (/^\s*<openID>[^<]+<\/openID>\s*$/.test(self.commandQueue[0])) {
				await xml2js
					.parseStringPromise(self.commandQueue[0])
					.then(function (result) {
						self.log('debug', 'Parsed data: ' + JSON.stringify(result))
						if (result.openID !== undefined) {
							if (result.openID == `${self.config.host}_0_4_0_0`) {
								self.context = ''
							} else {
								self.log('debug', 'Got likely room context: ' + result.openID)
								self.context = result.openID
							}
						} else {
							self.log('warn', "Didn't get any context")
						}
						if (self.workingBuffer.trim() == '<nack/>') {
							self.updateStatus(InstanceStatus.ConnectionFailure, 'Got NAck for command ' + self.commandQueue[0])
							self.log('warn', 'Got NAck for command ' + self.commandQueue[0])
							// Successful parse, clear buffer so we don't try and parse it again
							self.workingBuffer = ''
						} else if (self.workingBuffer.trim() == '<ack/>') {
							self.updateStatus(InstanceStatus.Ok)
							self.log('info', 'Got Ack for command ' + self.commandQueue[0])
							// Successful parse, clear buffer so we don't try and parse it again
							self.workingBuffer = ''
						} else {
							self.log('warn', 'Unknown response for command ' + self.commandQueue[0])
						}
					})
					.catch(function (err) {
						// Failed to parse
						self.log('warn', 'Failed to parse data, invalid XML: ' + self.commandQueue[0])
					})
			} else if (self.commandQueue[0] == '<closeID/>') {
				if (self.workingBuffer.trim() == '<nack/>') {
					self.updateStatus(
						InstanceStatus.UnknownError,
						'Got NAck for command ' + self.commandQueue[0] + ' in context ' + self.context,
					)
					self.log('warn', 'Got NAck for command ' + self.commandQueue[0] + ' in context ' + self.context)
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
				} else if (self.workingBuffer.trim() == '<ack/>') {
					self.log('info', 'Got Ack for command ' + self.commandQueue[0] + ' in context ' + self.context)
					if (self.context == '') {
						// Implies connection closed
						self.updateStatus(InstanceStatus.Disconnected)
					} else {
						// Switch to root level instead
						self.context = ''
					}
					// Successful parse, clear buffer so we don't try and parse it again
					self.workingBuffer = ''
				} else {
					self.updateStatus(
						InstanceStatus.UnknownError,
						'Unknown response for command ' + self.commandQueue[0] + ' in context ' + self.context,
					)
					self.log('warn', 'Unknown response for command ' + self.commandQueue[0] + ' in context ' + self.context)
				}
			} else {
				// This shouldn't happen unless something has gone wrong, or we've sent a command we've forgotten to add above...
				self.updateStatus(
					InstanceStatus.UnknownError,
					'Unhandled command in queue ' + self.commandQueue[0] + ' in context ' + self.context,
				)
				self.log('warn', 'Unhandled command in queue ' + self.commandQueue[0])
				// Ignore and move onto the next thing; hoping that we've got the whole response already
				self.workingBuffer = ''
			}
		} else {
			// This shouldn't happen unless something has gone wrong, e.g. a command above which we've not handled, and then not read all of in one go
			self.updateStatus(InstanceStatus.UnknownError, 'Got data without command in context ' + self.context)
			self.log('warn', 'Got data without command')
			// Ignore and move onto the next thing; hoping that we've now got the whole response
			self.workingBuffer = ''
		}

		// Process end of responses, only move on if we've dealt with everything...
		if (self.workingBuffer == '') {
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
			self.updateStatus(InstanceStatus.Connecting)

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

				// Read current layout
				// Per room (if present, handled later)...
				self.queueCommand('<getKCurrentLayout/>')
			})

			self.socket.on('error', function (err) {
				self.log('error', 'Network error: ' + err.message)
			})

			// Process incoming data
			self.socket.on('data', function (buffer) {
				var indata = buffer.toString('utf8')
				self.incomingData(indata)
			})
		} else {
			self.updateStatus(InstanceStatus.BadConfig, `IP address is missing`)
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
		if (this.roomNames.length > 0) {
			for (const room of this.roomNames) {
				variableDefinitions.push({
					name: `Current Layout ${room.label}`,
					variableId: `current_layout_${room.id}`,
				})
			}
		} else {
			variableDefinitions.push({
				name: `Current Layout`,
				variableId: `current_layout`,
			})
		}

		this.setVariableDefinitions(variableDefinitions)
	}
}

runEntrypoint(KaleidoInstance, UpgradeScripts)
