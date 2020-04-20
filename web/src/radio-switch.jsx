import React from 'react'
import PropTypes from 'prop-types'

// RadioSwitch is an internal component in HireFast, just
// replacing it temporarily with a checkbox
export function RadioSwitch({
	value,
	onChange,
	'data-test': dataTest,
	className = '',
	children,
}) {
	return (
		<div className={`form-check ${className}`}>
			<input
				data-test={dataTest}
				className="form-check-input"
				type="checkbox"
				checked={value}
				onChange={(evt) => onChange(evt.target.checked)}
			/>
			<label
				className="form-check-label"
				onClick={(evt) => {
					evt.preventDefault()
					onChange(!value)
				}}
			>
				{children}
			</label>
		</div>
	)
}
RadioSwitch.propTypes = {
	value: PropTypes.bool.isRequired,
	onChange: PropTypes.func.isRequired,
	className: PropTypes.string,
	'data-test': PropTypes.string,
}
