const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  minDelaySec: 2,
  maxDelaySec: 6,
  fixedBackoff: false,
  chromePath: '',
  slowMode: false,
  aiLegalContext: '',
  aiBatchSize: 100,
  likesAddCounterOverlay: false,
  likesSecondBottomPass: false,
};

class SettingsService {
  constructor() {
    const userData = app.getPath('userData');
    this.settingsPath = path.join(userData, 'settings.json');
    this.cache = null;
  }

  async loadSettings() {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        await fs.writeJson(this.settingsPath, DEFAULT_SETTINGS, { spaces: 2 });
        this.cache = { ...DEFAULT_SETTINGS };
        return this.cache;
      }
      const data = await fs.readJson(this.settingsPath);
      this.cache = { ...DEFAULT_SETTINGS, ...data };
      return this.cache;
    } catch (e) {
      this.cache = { ...DEFAULT_SETTINGS };
      return this.cache;
    }
  }

  async getSettings() {
    if (this.cache) return this.cache;
    return this.loadSettings();
  }

  async saveSettings(next) {
    const current = await this.getSettings();
    const merged = { ...current, ...next };
    await fs.writeJson(this.settingsPath, merged, { spaces: 2 });
    this.cache = merged;
    return this.cache;
  }
}

module.exports = { SettingsService, DEFAULT_SETTINGS };


