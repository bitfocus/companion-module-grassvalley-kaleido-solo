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

const mockContext = {
	// For now, just do nothing and confirm it's been called
	parseVariablesInString: jest.fn((string) => string),
}

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
		instance.checkFeedbacks = jest.fn()
		instance.setVariableValues = jest.fn()
		instance.setActionDefinitions = jest.fn()
		instance.setFeedbackDefinitions = jest.fn()
		instance.setPresetDefinitions = jest.fn()
		instance.setVariableDefinitions = jest.fn()
	})

	afterEach(() => {
		expect(instance.workingBuffer).toEqual('')
		jest.clearAllMocks()
	})

	describe('getConfigFields', () => {
		test('should return an array of config fields', () => {
			// Invoke the method
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
			// Without space in name
			expect(instance.parseKeyValueResponse('<kCurrentLayout>name="CurrentLayout.kg2"</kCurrentLayout>')).toEqual({
				key: 'name',
				value: 'CurrentLayout.kg2',
			})
			// With space in name
			expect(instance.parseKeyValueResponse('<kCurrentLayout>name="Current Layout.kg2"</kCurrentLayout>')).toEqual({
				key: 'name',
				value: 'Current Layout.kg2',
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

			test('should handle unsuccessful software version', async () => {
				instance.commandQueue = ['<getParameterInfo>get key="softwareVersion"</getParameterInfo>']
				await instance.incomingData('<nack/>')
				expect(instance.updateStatus).not.toHaveBeenCalled()
			})

			test('should handle system name', async () => {
				instance.commandQueue = ['<getParameterInfo>get key="systemName"</getParameterInfo>']
				await instance.incomingData('<kParameterInfo>systemName="Cougar-X"</kParameterInfo>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					system_name: 'Cougar-X',
				})
			})

			test('should handle unsuccessful system name', async () => {
				instance.commandQueue = ['<getParameterInfo>get key="systemName"</getParameterInfo>']
				await instance.incomingData('<nack/>')
				expect(instance.updateStatus).not.toHaveBeenCalled()
			})

			test('should handle current layout for Alto or Quad', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>Currentlayout.xml</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: 'Currentlayout.xml',
				})
			})

			test('should handle current layout for Solo', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>USER PRESET 1</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: 'USER PRESET 1',
				})
			})

			test('should handle current layout for Alto or Quad without layout', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout></kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: '',
				})
			})

			test('should handle current layout for Alto or Quad without layout, alternative format', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout/>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: '',
				})
			})

			test('should handle current layout for K2 or Kaleido Software', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>name="Current Layout.kg2"</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout: 'Current Layout.kg2',
				})
			})

			test('should handle current layout for K2 or Kaleido Software with room context', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				instance.context = 'FOO'
				await instance.incomingData('<kCurrentLayout>name="Current Layout.kg2"</kCurrentLayout>')
				expect(instance.setVariableValues).toHaveBeenCalledWith({
					current_layout_FOO: 'Current Layout.kg2',
				})
			})

			test('should handle getting layout list for Solo', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>"USER PRESET 1" "USER PRESET 2" "USER PRESET 3" </kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'USER PRESET 1', label: 'USER PRESET 1' },
					{ id: 'USER PRESET 2', label: 'USER PRESET 2' },
					{ id: 'USER PRESET 3', label: 'USER PRESET 3' },
				])
			})

			test('should handle packetised layout list for Solo', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>"USER PRESET 1" "USER PRESET 2"')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet; technically would be no extension in reality
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' "USER PRESET 3" </kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'USER PRESET 1', label: 'USER PRESET 1' },
					{ id: 'USER PRESET 2', label: 'USER PRESET 2' },
					{ id: 'USER PRESET 3', label: 'USER PRESET 3' },
				])
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
				await instance.incomingData('<kLayoutList>Layout1.kg2 Layout 2.kg2 AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.kg2', label: 'Layout1' },
					{ id: 'Layout 2.kg2', label: 'Layout 2' },
					{ id: 'AnAvailableLayout.kg2', label: 'AnAvailableLayout' },
				])
			})

			test('should handle getting layout list for K2 or Kaleido Software with rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData(
					'<kLayoutList>ROOM1/Layout1.kg2 ROOM1/Layout 2.kg2 ROOM 2/AnAvailableLayout.kg2</kLayoutList>',
				)
				expect(instance.presetNames).toEqual([
					{ id: 'ROOM1/Layout1.kg2', label: 'ROOM1/Layout1' },
					{ id: 'ROOM1/Layout 2.kg2', label: 'ROOM1/Layout 2' },
					{ id: 'ROOM 2/AnAvailableLayout.kg2', label: 'ROOM 2/AnAvailableLayout' },
				])
			})

			test('should handle packetised layout list for K2 or Kaleido Software without rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>Layout1.kg2 Layout 2.kg2')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.kg2', label: 'Layout1' },
					{ id: 'Layout 2.kg2', label: 'Layout 2' },
					{ id: 'AnAvailableLayout.kg2', label: 'AnAvailableLayout' },
				])
			})

			test('should handle packetised layout list for K2 or Kaleido Software with rooms', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>ROOM1/Layout1.kg2 ROOM1/Layout 2.kg2')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' ROOM 2/AnAvailableLayout.kg2</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'ROOM1/Layout1.kg2', label: 'ROOM1/Layout1' },
					{ id: 'ROOM1/Layout 2.kg2', label: 'ROOM1/Layout 2' },
					{ id: 'ROOM 2/AnAvailableLayout.kg2', label: 'ROOM 2/AnAvailableLayout' },
				])
			})

			test('should handle getting layout list for Alto or Quad', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>Layout1.xml Layout 2.xml AnAvailableLayout.xml</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.xml', label: 'Layout1' },
					{ id: 'Layout 2.xml', label: 'Layout 2' },
					{ id: 'AnAvailableLayout.xml', label: 'AnAvailableLayout' },
				])
			})

			test('should handle packetised layout list for Alto or Quad', async () => {
				instance.commandQueue = ['<getKLayoutList/>']
				await instance.incomingData('<kLayoutList>Layout1.xml Layout 2.xml')
				expect(instance.processQueue).not.toHaveBeenCalled()
				expect(instance.workingBuffer).not.toEqual('')
				// Should be the original, untouched, data as we've not successfully parsed info yet; technically would be .xml in reality
				expect(instance.presetNames).toEqual([{ id: 'BAR.kg2', label: 'BAR' }])
				await instance.incomingData(' AnAvailableLayout.xml</kLayoutList>')
				expect(instance.presetNames).toEqual([
					{ id: 'Layout1.xml', label: 'Layout1' },
					{ id: 'Layout 2.xml', label: 'Layout 2' },
					{ id: 'AnAvailableLayout.xml', label: 'AnAvailableLayout' },
				])
			})

			test('should handle setting layout', async () => {
				instance.commandQueue = ['<setKCurrentLayout>set Layout 1</setKCurrentLayout>']
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
				expect(instance.setVariableDefinitions).toHaveBeenCalledWith([
					{
						name: 'Software Version',
						variableId: 'software_version',
					},
					{
						name: 'System Name',
						variableId: 'system_name',
					},
					{
						name: 'Current Layout',
						variableId: 'current_layout',
					},
				])
			})

			test('should handle getting room list with no rooms, alternative format', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList/>')
				expect(instance.roomNames).toEqual([])
				expect(instance.setVariableDefinitions).toHaveBeenCalledWith([
					{
						name: 'Software Version',
						variableId: 'software_version',
					},
					{
						name: 'System Name',
						variableId: 'system_name',
					},
					{
						name: 'Current Layout',
						variableId: 'current_layout',
					},
				])
			})

			test('should handle unsuccessful room list request', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<nack/>')
				expect(instance.updateStatus).not.toHaveBeenCalled()
				expect(instance.roomNames).toEqual([])
				expect(instance.setVariableDefinitions).toHaveBeenCalledWith([
					{
						name: 'Software Version',
						variableId: 'software_version',
					},
					{
						name: 'System Name',
						variableId: 'system_name',
					},
					{
						name: 'Current Layout',
						variableId: 'current_layout',
					},
				])
			})

			test('should handle unknown command', async () => {
				instance.commandQueue = ['<getKFoo/>']
				await instance.incomingData('<kFoo>Bar</kFoo>')
				expect(instance.updateStatus).toHaveBeenCalledWith(
					InstanceStatus.UnknownError,
					'Unhandled command in queue <getKFoo/> in context ',
				)
			})

			test('should handle gratuitous data', async () => {
				// E.g. if we didn't originally handle all of an unknown command successfully
				instance.commandQueue = []
				await instance.incomingData('</kFoo>')
				expect(instance.updateStatus).toHaveBeenCalledWith(
					InstanceStatus.UnknownError,
					'Got data without command in context ',
				)
			})
		})

		describe('producing commands', () => {
			afterEach(() => {
				// Producing commands cause more commands to be queued so should end up with a non-empty queue afterwards
				expect(instance.commandQueue).not.toEqual([])
			})

			test('should handle getting room list with a single room', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList><room>ROOM 1</room></kRoomList>')
				expect(instance.roomNames).toEqual([{ id: 'ROOM 1', label: 'ROOM 1' }])
				expect(instance.commandQueue).toEqual(['<openID>ROOM 1</openID>', '<getKCurrentLayout/>', '<closeID/>'])
				expect(instance.setVariableDefinitions).toHaveBeenCalledWith([
					{
						name: 'Software Version',
						variableId: 'software_version',
					},
					{
						name: 'System Name',
						variableId: 'system_name',
					},
					{
						name: 'Current Layout ROOM 1',
						variableId: 'current_layout_ROOM 1',
					},
				])
			})

			test('should handle getting room list with multiple rooms', async () => {
				instance.commandQueue = ['<getKRoomList/>']
				await instance.incomingData('<kRoomList><room>ROOMA</room><room>ROOM B</room></kRoomList>')
				expect(instance.roomNames).toEqual([
					{ id: 'ROOMA', label: 'ROOMA' },
					{ id: 'ROOM B', label: 'ROOM B' },
				])
				expect(instance.commandQueue).toEqual([
					'<openID>ROOMA</openID>',
					'<getKCurrentLayout/>',
					'<closeID/>',
					'<openID>ROOM B</openID>',
					'<getKCurrentLayout/>',
					'<closeID/>',
				])
				expect(instance.setVariableDefinitions).toHaveBeenCalledWith([
					{
						name: 'Software Version',
						variableId: 'software_version',
					},
					{
						name: 'System Name',
						variableId: 'system_name',
					},
					{
						name: 'Current Layout ROOMA',
						variableId: 'current_layout_ROOMA',
					},
					{
						name: 'Current Layout ROOM B',
						variableId: 'current_layout_ROOM B',
					},
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

	describe('feedbacks', () => {
		describe('getFeedbacks', () => {
			test('getFeedbacks has required feedbacks', () => {
				const feedbacks = instance.getFeedbacks()
				expect(feedbacks).toHaveProperty('current_layout')
			})
		})

		describe('test feedbacks', () => {
			const currentLayoutCheckNoRoom = {
				id: 'abcd1234',
				type: 'boolean',
				feedbackId: 'current_layout',
				options: {
					room: '',
					layout: 'foo.kg2',
				},
				_page: 0,
				_bank: 0,
				_rawBank: 'test',
				controlId: 'control0',
			}

			const currentLayoutCheckRoom = {
				id: 'abcd1234',
				type: 'boolean',
				feedbackId: 'current_layout',
				options: {
					room: 'BAZ',
					layout: 'foo.kg2',
				},
				_page: 0,
				_bank: 0,
				_rawBank: 'test',
				controlId: 'control0',
			}

			const currentLayoutCheckOtherRoom = {
				id: 'abcd1234',
				type: 'boolean',
				feedbackId: 'current_layout',
				options: {
					room: 'BAK',
					layout: 'foo.kg2',
				},
				_page: 0,
				_bank: 0,
				_rawBank: 'test',
				controlId: 'control0',
			}

			test('current layout feedback without room to match', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>name="foo.kg2"</kCurrentLayout>')

				const feedbacks = instance.getFeedbacks()
				await expect(feedbacks.current_layout.callback(currentLayoutCheckNoRoom, mockContext)).resolves.toBe(true)
				expect(mockContext.parseVariablesInString).toHaveBeenCalled()
			})

			test('current layout feedback without room to not match', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				await instance.incomingData('<kCurrentLayout>name="bar.kg2"</kCurrentLayout>')

				const feedbacks = instance.getFeedbacks()
				await expect(feedbacks.current_layout.callback(currentLayoutCheckNoRoom, mockContext)).resolves.toBe(false)
				expect(mockContext.parseVariablesInString).toHaveBeenCalled()
			})

			test('current layout feedback with room to match', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				instance.context = 'BAZ'
				await instance.incomingData('<kCurrentLayout>name="foo.kg2"</kCurrentLayout>')

				const feedbacks = instance.getFeedbacks()
				await expect(feedbacks.current_layout.callback(currentLayoutCheckRoom, mockContext)).resolves.toBe(true)
				expect(mockContext.parseVariablesInString).toHaveBeenCalled()
			})

			test('current layout feedback with room to not match', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				instance.context = 'BAZ'
				await instance.incomingData('<kCurrentLayout>name="bar.kg2"</kCurrentLayout>')

				const feedbacks = instance.getFeedbacks()
				await expect(feedbacks.current_layout.callback(currentLayoutCheckRoom, mockContext)).resolves.toBe(false)
				expect(mockContext.parseVariablesInString).toHaveBeenCalled()
			})

			test('current layout feedback with other room to not match', async () => {
				instance.commandQueue = ['<getKCurrentLayout/>']
				instance.context = 'BAZ'
				await instance.incomingData('<kCurrentLayout>name="bar.kg2"</kCurrentLayout>')

				const feedbacks = instance.getFeedbacks()
				await expect(feedbacks.current_layout.callback(currentLayoutCheckOtherRoom, mockContext)).resolves.toBe(false)
				expect(mockContext.parseVariablesInString).toHaveBeenCalled()
			})
		})

		describe('initFeedbacks', () => {
			test('initFeedbacks should set feedbacks', () => {
				// Invoke the method
				instance.initFeedbacks()

				expect(instance.setFeedbackDefinitions).toHaveBeenCalled()
			})
		})
	})
})
