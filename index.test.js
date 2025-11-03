// Import the necessary modules and classes
const runEntrypoint = require('@companion-module/base').runEntrypoint

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
		instance.log = jest.fn()
		instance.updateStatus = jest.fn()
		instance.workingBuffer = ''
		instance.commandQueue = []
		instance.roomNames = [{ id: 'FOO', label: 'FOO' }]
		instance.presetNames = [{ id: 'BAR.kg2', label: 'BAR' }]
		instance.setVariableValues = jest.fn()
		instance.setActionDefinitions = jest.fn()
	})

	afterEach(() => {
		expect(instance.workingBuffer).toEqual('')
		expect(instance.commandQueue).toEqual([])
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
		test('should handle software version', () => {
			instance.commandQueue = ['<getParameterInfo>get key="softwareVersion"</getParameterInfo>']
			expect(instance.incomingData('<kParameterInfo>softwareVersion="8.40 build 1234"</kParameterInfo>')).toEqual()
			expect(instance.setVariableValues).toHaveBeenCalledWith({
				software_version: '8.40 build 1234',
			})
		})

		test('should handle system name', () => {
			instance.commandQueue = ['<getParameterInfo>get key="systemName"</getParameterInfo>']
			expect(instance.incomingData('<kParameterInfo>systemName="Cougar-X"</kParameterInfo>')).toEqual()
			expect(instance.setVariableValues).toHaveBeenCalledWith({
				system_name: 'Cougar-X',
			})
		})

		/*test('should handle current layout for Alto or Quad', () => {
			instance.commandQueue = ['<getKCurrentLayout/>']
			expect(instance.incomingData('<kCurrentLayout>Currentlayout.xml</kCurrentLayout>')).toEqual()
			expect(instance.setVariableValues).toHaveBeenCalledWith({
				current_layout: 'Currentlayout.xml',
			})
		})*/

		test('should handle current layout for K2 or Kaleido Software', () => {
			instance.commandQueue = ['<getKCurrentLayout/>']
			expect(instance.incomingData('<kCurrentLayout>name="CurrentLayout.kg2"</kCurrentLayout>')).toEqual()
			expect(instance.setVariableValues).toHaveBeenCalledWith({
				current_layout: 'CurrentLayout.kg2',
			})
		})

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

		test('should handle packetised layout list for K2 or Kaleido Software', async () => {
			instance.commandQueue = ['<getKLayoutList/>']
			await instance.incomingData('<kLayoutList>Layout1.kg2 Layout2.kg2')
			// Should be the original, untouched, data as we've not successfully parsed info yet
			expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
			await instance.incomingData(' AnAvailableLayout.kg2</kLayoutList>')
			expect(instance.presetNames).toEqual([
				{ id: 'Layout1.kg2', label: 'Layout1' },
				{ id: 'Layout2.kg2', label: 'Layout2' },
				{ id: 'AnAvailableLayout.kg2', label: 'AnAvailableLayout' },
			])
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

		test('should handle getting room list with a single room', async () => {
			instance.commandQueue = ['<getKRoomList/>']
			await instance.incomingData('<kRoomList><room>ROOM1</room></kRoomList>')
			expect(instance.roomNames).toEqual([{ id: 'ROOM1', label: 'ROOM1' }])
		})

		test('should handle getting room list with multiple rooms', async () => {
			instance.commandQueue = ['<getKRoomList/>']
			await instance.incomingData('<kRoomList><room>ROOMA</room><room>ROOMB</room></kRoomList>')
			expect(instance.roomNames).toEqual([
				{ id: 'ROOMA', label: 'ROOMA' },
				{ id: 'ROOMB', label: 'ROOMB' },
			])
		})

		/*test('', () => {
			instance.commandQueue = ['']
			expect(instance.incomingData('')).toEqual()
			expect(instance.setVariableValues).toHaveBeenCalledWith({
			})
		})*/
	})
})
