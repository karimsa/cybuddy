import React from 'react'
import PropTypes from 'prop-types'

import { Spinner } from './spinner'

export function ButtonDropdown({
	children,
	variant = 'primary',
	choices,
	isLoading,
	disabled,
	className,
	onSelect,
}) {
	return (
		<div className={`dropdown ${className || ''}`}>
			<button
				type="button"
				className={`btn btn-block btn-${variant} dropdown-toggle d-flex align-items-center justify-content-center`}
				disabled={disabled || isLoading}
				data-toggle="dropdown"
			>
				{isLoading && <Spinner color="light" />}
				<span className="ml-2">{children}</span>
			</button>

			<div className="dropdown-menu">
				{choices.map(([key, value]) => (
					<a
						href="#"
						className="dropdown-item"
						key={key}
						onClick={(evt) => {
							evt.preventDefault()
							onSelect(key)
						}}
					>
						{value}
					</a>
				))}
			</div>
		</div>
	)
}
ButtonDropdown.propTypes = {
	choices: PropTypes.any.isRequired,
	className: PropTypes.string,
	variant: PropTypes.string,
	isLoading: PropTypes.bool,
	disabled: PropTypes.bool,
	onSelect: PropTypes.func.isRequired,
}
