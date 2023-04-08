exports.getActions = function(presetNames) {

	tallyColors = [
		{
			id: 'green',
			label: 'Green',
		},
		{
			id: 'red',
			label: 'Red',
		},
	];
	
	alarmStates = [
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
			label: 'Set tally',
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
		},
		'alarm': {
			label: 'Set alarm state',
			options: [
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					default: 'normal',
					choices: alarmStates,
				},
			],
		},
		'umd': {
			label: 'Set UMD text',
			options: [
				{
					type: 'textinput',
					label: 'UMD text',
					tooltip: "Supports variables",
					id: 'text',
					default: '',
				},
			],
		},
		'preset': {
			label: 'Recall preset',
			options: [
				{
					type: 'dropdown',
					label: 'Preset name',
					id: 'name',
					default: 'USER PRESET 1',
					choices: presetNames,
				},
			],
		}
	};

	return(actions);
}
