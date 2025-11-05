// Import the necessary modules and classes
const runEntrypoint = require('@companion-module/base').runEntrypoint
const { InstanceStatus } = require('@companion-module/base')

// Mock Companion to get the class
jest.mock('@companion-module/base', () => {
	const original = jest.requireActual('@companion-module/base')
	return {
		...original,
		InstanceBase: jest.fn(),
		runEntrypoint: jest.fn(),
	}
})

// Define the test suite for ModuleInstance
describe('ModuleInstance', () => {
	let instance

	const ModuleInstance = require('./index')
	const module = runEntrypoint.mock.calls[0][0]

	beforeEach(() => {
		instance = new module('')
		instance.config = { host: '1.2.3.4' }
		instance.log = jest.fn()
		instance.updateStatus = jest.fn()
		instance.processQueue = jest.fn()
		instance.context = ''
		instance.workingBuffer = ''
		instance.commandQueue = []
		instance.roomNames = [{ id: 'FOO', label: 'FOO' }]
		instance.presetNames = [{ id: 'BAR.kg2', label: 'BAR' }]
		instance.setVariableValues = jest.fn()
		instance.setActionDefinitions = jest.fn()
	})

	afterEach(() => {
		expect(instance.workingBuffer).toEqual('')
		jest.clearAllMocks()
	})

	describe('getConfigFields', () => {
		test('should return an array of config fields', () => {
			// Invoke the method
			instance.config = {
				supportsManualAdjustments: false,
			}
			const configFields = instance.getConfigFields()

			// Assertions
			expect(Array.isArray(configFields)).toBe(true)
			expect(configFields.length).toBe(2)
		})
	})

	describe('parseKeyValueResponse', () => {
		test('parse a simple key value response', () => {
			expect(
				instance.parseKeyValueResponse('<kParameterInfo>softwareVersion="8.40 build 1234"</kParameterInfo>'),
			).toEqual({ key: 'softwareVersion', value: '8.40 build 1234' })
			expect(instance.parseKeyValueResponse('<kParameterInfo>systemName="Cougar-X"</kParameterInfo>')).toEqual({
				key: 'systemName',
				value: 'Cougar-X',
			})
			expect(instance.parseKeyValueResponse('<kCurrentLayout>name="CurrentLayout.kg2"</kCurrentLayout>')).toEqual({
				key: 'name',
				value: 'CurrentLayout.kg2',
			})
			// Empty value
			expect(instance.parseKeyValueResponse('<kParameterInfo>foo=""</kParameterInfo>')).toEqual({
				key: 'foo',
				value: '',
			})
		})

		test('return undefined for invalid responses', () => {
			// No closing >
			expect(instance.parseKeyValueResponse('<kParameterInfo>foo="bar"</kParameterInfo')).toEqual(undefined)
			// No ending quote
			expect(instance.parseKeyValueResponse('<kParameterInfo>foo="bar</kParameterInfo>')).toEqual(undefined)
			// No key
			expect(instance.parseKeyValueResponse('<kParameterInfo>="bar"</kParameterInfo>')).toEqual(undefined)
			// No value at all
			expect(instance.parseKeyValueResponse('<kParameterInfo>foo=</kParameterInfo>')).toEqual(undefined)
			// No response data
			expect(instance.parseKeyValueResponse('<kParameterInfo></kParameterInfo>')).toEqual(undefined)
			expect(instance.parseKeyValueResponse('<kParameterInfo/>')).toEqual(undefined)
			// Empty response
			expect(instance.parseKeyValueResponse('')).toEqual(undefined)
			// Undefined response
			expect(instance.parseKeyValueResponse(undefined)).toEqual(undefined)
		})
	})

	describe('incomingData', () => {
		afterEach(() => {
			// Queue should have moved on after each test
			expect(instance.processQueue).toHaveBeenCalled()
		})

		describe('consuming commands', () => {
			afterEach(() => {
				// Consuming commands should end up with an empty queue afterwards
				expect(instance.commandQueue).toEqual([])
			})

			test('should handle successful initial open', async () => {
				instance.commandQueue = ['<openID>1.2.3.4_0_4_0_0</openID>']
				await instance.incomingData('<ack/>')
				expect(instance.updateStatus).toHaveBeenCalledWith(InstanceStatus.Ok)
			})

			test('should handle unsuccessful initial open', async () => {
				instance.commandQueue = ['<openID>1.2.3.4_0_4_0_0</openID>']
				await instance.incomingData('<nack/>')
				expect(instance.updateStatus).toHaveBeenCalledWith(
					InstanceStatus.ConnectionFailure,
					'Got NAck for command <openID>1.2.3.4_0_4_0_0</openID>',
				)
			})

			test('should handle successful initial close', async () => {
				instance.commandQueue = ['<closeID/>']
				await instance.incomingData('<ack/>')
				expect(instance.updateStatus).toHaveBeenCalledWith(InstanceStatus.Disconnected)
			})

			test('should handle unsuccessful initial close', async () => {
				instance.commandQueue = ['<closeID/>']
				await instance.incomingData('<nack/>')
				expect(instance.updateStatus).toHaveBeenCalledWith(
					InstanceStatus.UnknownError,
					'Got NAck for command <closeID/> in context ',
				)
			})

			test('should handle software version', async () => {
				instance.commandQueue = ['<getParameterInfo>get key="softwareVersion"</getParameterInfo>']
				await instance.incomingData('<kParameterInfo>softwareVersion="8.40 build 1234"</kParameterInfo>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					software_version: '8.40 build 1234',
				})
			})

			test('should handle system name', async () => {
				instance.commandQueue = ['<getParameterInfo>get key="systemName"</getParameterInfo>']
				await instance.incomingData('<kParameterInfo>systemName="Cougar-X"</kParameterInfo>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					system_name: 'Cougar-X',
				})
			})

			/*test('should handle current layout for Alto or Quad', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>Currentlayout.xml</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: 'Currentlayout.xml',
				})
			})*/

			test('should handle current layout for K2 or Kaleido Software', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>name="CurrentLayout.kg2"</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: 'CurrentLayout.kg2',
				})
			})

			/*test('should handle getting layout list for Solo', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				// This is reverse engineered guesswork based on what the original code did...
				await instance.incomingData('<kLayoutList>"Layout1.xml" "Layout2.xml" "AnAvailableLayout.xml"</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.xml', label: 'Layout1.xml' },
					{ id: 'Layout2.xml', label: 'Layout2.xml' },
					{ id: 'AnAvailableLayout.xml', label: 'AnAvailableLayout.xml' },
				])
			})*/

			test('should handle getting layout list for K2 or Kaleido Software with no presets', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList></kLayoutList>')
				expect(instance.presetNames).toEqual([])
			})

			test('should handle getting layout list for K2 or Kaleido Software with no presets, alternative format', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList/>')
				expect(instance.presetNames).toEqual([])
			})

			test('should handle getting layout list for K2 or Kaleido Software without room', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>Layout1.kg2 Layout2.kg2 AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.kg2', label: 'Layout1' },
					{ id: 'Layout2.kg2', label: 'Layout2' },
					{ id: 'AnAvailableLayout.kg2', label: 'AnAvailableLayout' },
				])
			})

			test('should handle getting layout list for K2 or Kaleido Software with rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData(
					'<kLayoutList>ROOM1/Layout1.kg2 ROOM1/Layout2.kg2 ROOM2/AnAvailableLayout.kg2</kLayoutList>',
				)
				expect(instance.presetNames).toEqual([
					{ id: 'ROOM1/Layout1.kg2', label: 'ROOM1/Layout1' },
					{ id: 'ROOM1/Layout2.kg2', label: 'ROOM1/Layout2' },
					{ id: 'ROOM2/AnAvailableLayout.kg2', label: 'ROOM2/AnAvailableLayout' },
				])
			})

			test('should handle packetised layout list for K2 or Kaleido Software without rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>Layout1.kg2 Layout2.kg2')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.kg2', label: 'Layout1' },
					{ id: 'Layout2.kg2', label: 'Layout2' },
					{ id: 'AnAvailableLayout.kg2', label: 'AnAvailableLayout' },
				])
			})

			test('should handle packetised layout list for K2 or Kaleido Software with rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>ROOM1/Layout1.kg2 ROOM1/Layout2.kg2')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' ROOM2/AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'ROOM1/Layout1.kg2', label: 'ROOM1/Layout1' },
					{ id: 'ROOM1/Layout2.kg2', label: 'ROOM1/Layout2' },
					{ id: 'ROOM2/AnAvailableLayout.kg2', label: 'ROOM2/AnAvailableLayout' },
				])
			})

			test('should handle setting layout', async () => {
				instance.commandQueue = ['<setKCurrentLayout>set </setKCurrentLayout>']
				await instance.incomingData('<ack/>')
			})

			test('should handle setting UMD text', async () => {
				instance.commandQueue = ['<setKDynamicText>set address="0" text="Foo"</setKDynamicText>']
				await instance.incomingData('<ack/>')
			})

			test('should handle setting status message', async () => {
				instance.commandQueue = ['<setKStatusMessage>set id="1" status="MINOR"</setKStatusMessage>']
				await instance.incomingData('<ack/>')
			})

			test('should handle getting room list with no rooms', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList></kRoomList>')
				expect(instance.roomNames).toEqual([])
			})

			test('should handle getting room list with no rooms, alternative format', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList/>')
				expect(instance.roomNames).toEqual([])
			})
		})

		describe('producing commands', () => {
			afterEach(() => {
				// Producing commands cause more commands to be queued so should end up with a non-empty queue afterwards
				expect(instance.commandQueue).not.toEqual([])
			})

			test('should handle getting room list with a single room', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList><room>ROOM1</room></kRoomList>')
				expect(instance.roomNames).toEqual([{ id: 'ROOM1', label: 'ROOM1' }])
				expect(instance.commandQueue).toEqual(['<openID>ROOM1</openID>', '<getKCurrentLayout/>', '<closeID/>'])
			})

			test('should handle getting room list with multiple rooms', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList><room>ROOMA</room><room>ROOMB</room></kRoomList>')
				expect(instance.roomNames).toEqual([
					{ id: 'ROOMA', label: 'ROOMA' },
					{ id: 'ROOMB', label: 'ROOMB' },
				])
				expect(instance.commandQueue).toEqual([
					'<openID>ROOMA</openID>',
					'<getKCurrentLayout/>',
					'<closeID/>',
					'<openID>ROOMB</openID>',
					'<getKCurrentLayout/>',
					'<closeID/>',
				])
			})

			/*test('', async () => {
				instance.commandQueue = ['']
				await instance.incomingData('')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
				})
			})*/
		})
	})
})
