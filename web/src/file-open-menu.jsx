import React from 'react'
import axios from 'axios'
import { v4 as uuid } from 'uuid'

import { ButtonDropdown } from './button-dropdown'
import { useAsyncAction, useAPI } from './hooks'

export function useFileOpenMenu() {
	const fileListState = useAPI('/api/test-files')
	const [fileOpenState, fileOpenActions] = useAsyncAction(async (filename) => {
		const { data } = await axios.get(`/api/test-files/${filename}`)
		// Regenerate step IDs to allow for configuration to be modified
		// outside of CyBuddy
		data.steps.forEach((step) => {
			step.id = uuid()
		})
		return data
	})

	return [
		fileOpenState,
		fileOpenActions,
		<ButtonDropdown
			key={null}
			className="btn-block"
			isLoading={fileListState.status === 'inprogress'}
			choices={
				fileListState.data
					? fileListState.data.map((filename) => [filename, filename])
					: []
			}
			onSelect={fileOpenActions.fetch}
		>
			Open test file
		</ButtonDropdown>,
	]
}
