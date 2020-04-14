import React from 'react'
import PropTypes from 'prop-types'

export function Spinner({ size = 'sm', color = 'primary' }) {
	if (size === 'sm') {
		return (
			<span
				className={`spinner-border spinner-border-sm text-${color}`}
				role="status"
				aria-hidden="true"
			></span>
		)
	}
	return (
		<div className={`spinner-border text-${color}`} role="status">
			<span className="sr-only">Loading...</span>
		</div>
	)
}
Spinner.propTypes = {
	size: PropTypes.oneOf(['sm', 'lg']),
	color: PropTypes.oneOf(['primary']),
}
