import './ui/styles.css'
import { Game } from './core/game.js'

const canvas = document.getElementById('stage')
const game = new Game(canvas)
window.__game = game
game.boot()
