const { combineRgb } = require('@companion-module/base')

module.exports = {
	initPresets: function () {
		let self = this

		let presets = []

		const colorWhite = combineRgb(255, 255, 255) // White
		const colorBlack = combineRgb(0, 0, 0) // Black
		const colorRed = combineRgb(255, 0, 0) // Red
		const colorGreen = combineRgb(0, 255, 0) // Green
		const colorYellow = combineRgb(255, 255, 0) // Yellow
		const colorAmber = combineRgb(255, 137, 0) // Amber
		const colorBlue = combineRgb(0, 0, 255) // Blue

		const foregroundColorDefault = colorWhite
		const foregroundColorAlternative = colorBlack
		const backgroundColorDefault = colorBlack
		const backgroundColorPresetSelected = colorYellow

		for (const preset of self.presetNames.sort(function (a, b) {
			return a.label.localeCompare(b.label)
		})) {
			//self.log('debug', 'Found detail for preset ' + JSON.stringify(preset))
			/*presets[`layout_${preset.id}`] = {
				category: `Layouts`,
				name: `Layout ${preset.name}`,
				type: 'text',
			}*/
			presets[`layout_${preset.id}`] = {
				category: `Layouts`,
				name: `Layout ${preset.label}`,
				type: 'button',
				style: {
					text: `${preset.label}`,
					color: foregroundColorDefault,
					bgcolor: backgroundColorDefault,
				},
				feedbacks: [
					{
						feedbackId: 'currentLayout',
						style: {
							color: foregroundColorAlternative,
							bgcolor: backgroundColorPresetSelected,
						},
						options: { preset: preset.id },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'preset',
								options: { name: preset.id },
							},
						],
						up: [],
					},
				],
			}
		}

		self.setPresetDefinitions(presets)
	},
}
