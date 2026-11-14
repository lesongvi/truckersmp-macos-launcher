const games = {
  ets2: {
    id: 'ets2',
    name: 'ETS2',
    folder: 'Euro Truck Simulator 2',
    exe: 'eurotrucks2.exe',
    target: 'ets2mp'
  },
  ats: {
    id: 'ats',
    name: 'ATS',
    folder: 'American Truck Simulator',
    exe: 'amtrucks.exe',
    target: 'atsmp'
  }
}
function selectedGame(settings = {}) {
  return games[settings.game === 'ats' ? 'ats' : 'ets2']
}
module.exports = { games, selectedGame }
