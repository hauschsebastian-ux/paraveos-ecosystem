'use strict';
const spotify = require('./spotify');
function computeCapabilities(user) {
  return {
    spotify: spotify.isConfigured(),
    manage_users: user.role === 'admin',
    manage_events: user.role === 'admin',
    view_finances: user.role === 'admin' || user.role === 'dj',
  };
}
module.exports = { computeCapabilities };
