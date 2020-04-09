import React from 'react'
import PropTypes from 'prop-types'

export function Alert({ children, type }) {
	return (
		<div className={`alert alert-${type} mb-0`} role="alert">
			{children}
		</div>
	)
}

Alert.propTypes = {
	type: PropTypes.oneOf(['danger', 'success', 'primary', 'warning']).isRequired,
}
