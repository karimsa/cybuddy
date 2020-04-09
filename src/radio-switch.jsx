import React from 'react'
import PropTypes from 'prop-types'

// RadioSwitch is an internal component in HireFast, just
// replacing it temporarily with a checkbox
export function RadioSwitch({ value, onChange, children }) {
	return (
		<div className="form-check">
			<input
				className="form-check-input"
				type="checkbox"
				value={value}
				onChange={(evt) => onChange(evt.target.checked)}
			/>
			<label className="form-check-label">{children}</label>
		</div>
	)
}
RadioSwitch.propTypes = {
	value: PropTypes.bool.isRequired,
	onChange: PropTypes.func.isRequired,
}
