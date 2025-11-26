const { combineRgb } = require('@companion-module/base')

module.exports = {
	getFeedbacks: function () {
		let self = this
		let feedbacks = {}

		const foregroundColor = combineRgb(255, 255, 255) // White
		const backgroundColorRed = combineRgb(255, 0, 0) // Red

		feedbacks.current_layout = {
			type: 'boolean',
			name: 'Room Layout Matches Selected Layout',
			description: 'Show feedback for room layout',
			options: [
				{
					type: 'dropdown',
					label: 'Room',
					id: 'room',
					choices: self.roomNames,
					default: self.roomNames !== undefined && self.roomNames.length > 0 ? self.roomNames[0].id : '',
				},
				{
					type: 'textinput',
					label: 'Layout (with extension if present)',
					id: 'layout',
					default: '',
					useVariables: true,
				},
			],
			defaultStyle: {
				color: foregroundColor,
				bgcolor: backgroundColorRed,
			},
			callback: async function (event, context) {
				let opt = event.options
				const layout = await context.parseVariablesInString(opt.layout)

				// TODO(Peter): Check the room exists too
				if (opt.room in self.DATA.rooms && self.DATA.rooms[opt.room] == layout) {
					return true
				}

				return false
			},
		}

		return feedbacks
	},

	initFeedbacks: function () {
		let self = this

		self.setFeedbackDefinitions(self.getFeedbacks())
	},
}
