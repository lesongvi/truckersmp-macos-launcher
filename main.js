const electron = require('electron')
const {createApplication} = require('./src/main')

createApplication(electron).start()
