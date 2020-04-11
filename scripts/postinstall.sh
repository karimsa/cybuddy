#!/bin/bash

if test -e "$(dirname $0)/../example"; then
	npm install --no-save react react-dom

	cd "$(dirname $0)/../example"
	npm install
fi
