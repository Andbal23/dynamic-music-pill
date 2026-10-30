import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { MusicController } from './src/controller.js';

export default class DynamicMusicExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._controller = new MusicController(this);
        this._controller.enable();
    }

    disable() {
        if (this._controller) {
            this._controller.disable();
            this._controller = null;
        }
        this._settings = null;
    }
}
