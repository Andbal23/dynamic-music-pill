<p align="center">
  <img src="screenshots/banner.svg" alt="Dynamic Music Pill" width="100%">
</p>

A dynamic, elegant, and highly customizable music widget for GNOME Shell. It brings a pill-shaped media controller with a live audio visualizer directly to your Dash or Panel, complete with a rich Pop-Up Menu.

---

<div align="center">

![Gnome Extensions Downloads](https://img.shields.io/gnome-extensions/dt/dynamic-music-pill@andbal) ![Views](https://komarev.com/ghpvc/?username=Andbal23&repo=dynamic-music-pill&label=Views&color=green) ![GNOME Shell](https://img.shields.io/badge/GNOME-45%20--%2049-blue?logo=gnome&logoColor=white) ![GitHub License](https://img.shields.io/github/license/Andbal23/dynamic-music-pill)
[![Stars](https://img.shields.io/github/stars/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/stargazers) [![Watchers](https://img.shields.io/github/watchers/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/watchers) [![Translation status](https://hosted.weblate.org/widgets/dynamic-music-pill/-/svg-badge.svg)](https://hosted.weblate.org/engage/dynamic-music-pill/)


</div>

---
<div align="center">
  <a align="center" href="https://extensions.gnome.org/extension/9334/dynamic-music-pill/">
    <img alt="Get it on GNOME Extensions" height="150" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true"/>
  </a>
  &nbsp;&nbsp;&nbsp;
  <a align="center" href="https://hosted.weblate.org/engage/dynamic-music-pill/">
    <img alt="Translation status" height="300" src="https://hosted.weblate.org/widget/dynamic-music-pill/multi-auto.svg"/>
  </a>
</div>

---

## Features

### Visuals & Rendering

**Adaptive Color Engine** — The pill's background color and visualizer accent are automatically extracted from the dominant color of the current track's album art, and update smoothly on every track change.

**Four Visualizer Modes** — Choose between Off, Wave (smooth continuous sine-like waveform), Beat (jumpy bar animation), or Real-Time (requires the `cava` package for live audio visualization). Bar count, bar width, height, and margin are all independently configurable.

**Per-Layer Transparency** — Transparency can be enabled globally and then applied individually to the background, album art, text, and visualizer, giving full compositing control without coupling layers together.

**Sync GNOME Accent Color** — Dynamically changes the GNOME Shell system accent color to match the dominant color of the currently playing album art, unifying the whole desktop aesthetic.

**Custom Color Override** — When adaptive colors are not desired, a full custom color mode lets you set fixed background and text colors via a color picker, overriding the dynamic system entirely.

**Pill Shadow** — An optional drop shadow can be applied to the main pill widget with independent control over blur radius and intensity.

**Outline Border** — A subtle border around the pill can be shown or hidden independently of the background and transparency settings.

**Dynamic Width** — The pill can automatically resize its width to fit the current track title, with the configured width acting as a maximum cap. Changes are animated with a crossfade.

### Playback Controls

**Configurable Click Actions** — Five interaction types can each be assigned an independent action: Left Click, Double Click, Middle Click, Right Click, and Hover. Available actions are: None, Play/Pause, Next Track, Previous Track, Open Player App, Close Player App, Open Pop-Up Menu, Select Player, and Open Settings.

**Hover Delay** — When a Hover action is assigned, a configurable delay (0–3000 ms) prevents the action from triggering immediately on accidental cursor contact.

**Scroll to Change Volume** — Scrolling over the pill adjusts system volume via PulseAudio/PipeWire with GNOME OSD feedback. A built-in delta accumulator ensures smooth and accurate behavior on high-resolution touchpads.

**Scroll to Change Track** — The scroll action can alternatively be set to skip forward or backward through the track queue.

**Scroll to Switch Player** — A third scroll mode cycles through active MPRIS-compatible media players, letting you control multiple apps without opening a menu.

**Scroll Direction Inversion** — Both the scroll animation direction (visual jump effect) and the actual scroll direction (up/down mapping for track and volume) can be inverted independently.

**Tablet Mode Controls** — A dedicated on-pill button overlay for touch and tablet use. Configurable to show Skip Only, Play/Pause Only, or All Controls directly on the pill surface.

**Always ON Mode** — The pill retains the last known track metadata and stays visible even after the media player is closed, instead of disappearing when no active player is detected.

**Hide Default GNOME Player** — Suppresses the built-in media controls widget in the GNOME Quick Settings panel to avoid duplicate interfaces.

### Display & Text

**Scrolling Track Title** — When the track title or artist name exceeds the available pill width, the text scrolls horizontally.

**Inline Artist** — When the pill is narrow or squeezed, the display can switch to a combined "Title • Artist" single-line format.

**Compact Mode** — Hides the title and artist text entirely, leaving only the album art and visualizer visible for a minimal footprint.

**Fallback Album Art** — A custom image file (PNG or JPEG) can be set as a fallback to display when the current track provides no album art.

**Synchronized Lyrics** — Real-time lyric display synchronized to the current track's playback position. Lyrics can optionally fade in with a configurable transition duration (50–2000 ms).

### Pop-Up Menu

**Seek Bar** — A fully interactive seek bar allows jumping to any position in the current track directly from the pop-up, without opening the player application.

**Spinning Vinyl** — The album art in the pop-up rotates continuously while music is playing, pausing automatically on pause. Rotation speed is adjustable (1–50).

**Square Album Art Mode** — The album art in the pop-up can be shown as a square instead of circular. When square mode is active, the spinning animation is automatically disabled.

**Shuffle and Loop Controls** — Optional shuffle and repeat toggle buttons can be shown in the pop-up alongside the standard playback controls.

**Custom Control Buttons** — Up to two additional buttons can be added to the pop-up controls row. Each button can be assigned one of: Volume, Seek Step, Audio Output, Sleep Timer, Playback Speed, or Recently Played history.

**Player Selector** — An optional row at the top of the pop-up displays icons for all currently active MPRIS players, allowing switching between players with a single click.

**Pop-up Visualizer** — The audio visualizer can also be displayed inside the pop-up menu, with its own independent bar count (2–64), bar width (1–20 px), and height (20–200 px) settings. A complementary option hides the main pill visualizer when the pop-up is open, creating a visual transfer effect.

**Dynamic Menu Resizing** — When skipping tracks from the pop-up, the menu smoothly resizes and crossfades to accommodate different album art dimensions.

**Close on Mouse Leave** — The pop-up can be configured to automatically close when the cursor moves away from it.

**Custom Pop-up Width** — The pop-up menu's automatic dynamic sizing can be overridden with a fixed custom width (260–800 px).

**Pop-up Styling Inheritance** — The pop-up can independently inherit the pill's background transparency, corner radius, custom background color, and custom text color.

**Dynamic Contrast** — Pop-up text and control buttons automatically switch between light and dark based on the album art's luminance, maintaining readability on both bright and dark covers.

### Layout & Positioning

**Four Placement Targets** — The pill can be placed in the Dock (requires Dash-to-Dock or Ubuntu Dock), or in any of the three Top Panel zones: Left Box, Center Box, or Right Box.

**Alignment Presets** — Within the chosen container, the pill can be aligned to First (Start), Center, Last (End), or placed at a manually specified index position.

**Independent Offset Control** — Vertical (Y) and Horizontal (X) offsets can be fine-tuned independently, with separate profiles stored for Dock mode and Panel mode.

**Independent Size Profiles** — Widget width, height, and album art thumbnail size are stored separately for Dock and Panel modes, with different valid ranges appropriate to each context.

**Corner Radius** — Controls the roundness of the widget edges globally, from fully square (0) to a complete pill shape (50+).

**Outer Edge Margin** — Adds spacing before the album art and after the visualizer to control padding at the pill's outer edges.

### Performance

**Game Mode** — Detects when a fullscreen application is focused and automatically disables the visualizer and all CSS animations to eliminate compositor overhead. Resumes automatically when the fullscreen application closes.

**Slow Player Workaround** — Adds a slight delay to track change handling to fix synchronization issues with players that emit metadata updates slightly after the track change signal.

### Multi-Player Management

**Player Filter** — Players can be filtered using a Blacklist (exclude named players) or Whitelist (allow only named players) mode, with the filter list editable as comma-separated MPRIS app names. Currently active players are detected live via D-Bus and can be added to the filter list with a single click.

**Manual App ID Mapping** — When the extension cannot automatically identify a player's window for Open/Close App actions, a manual mapping table allows pairing an MPRIS player name to its correct window App ID. Running players are detected via D-Bus and can be registered with one click, then edited in-place or deleted individually.

**Selected Player Lock** — The extension tracks which player is currently selected and maintains focus on it across track changes and player restarts.

### Settings Management

**Export Settings** — The complete configuration is serialized to a `.json` file saved to a user-selected path for backup or transfer between machines.

**Import Settings** — A previously exported `.json` file can be loaded to instantly restore a full configuration.

**Factory Reset** — All settings are reset to their defaults in a single action.

<p align="center">
  <img src="screenshots/features.svg" alt="Dynamic Music Pill" width="100%">
</p>

---


### Preview

<p align="center">
  <img src="screenshots/demo.gif" alt="Dynamic Music Pill Demo" width=100%>
</p>

---

## Installation

### From GNOME Extensions Store (Recommended)

<p align="center">
  <a href="https://extensions.gnome.org/extension/9334/dynamic-music-pill/">
    <img alt="Get it on GNOME Extensions" width="400" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true"/>
  </a>
</p>

### Manual Installation from Source

**1.** Clone the repository:

```bash
git clone https://github.com/Andbal23/dynamic-music-pill.git
```

**2.** Enter the directory:

```bash
cd dynamic-music-pill
```

**3.** Create the extension directory:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal
```

**4.** Copy all files:

```bash
cp -r * ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal/
```

**5.** Compile GSettings schemas:

```bash
cd ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal
glib-compile-schemas schemas/
```

**6.** Restart GNOME Shell:

- **X11:** Press `Alt+F2`, type `r`, and press `Enter`.
- **Wayland:** Log out and log back in.

**7.** Enable the extension via **GNOME Extensions**, **Extension Manager**, or:

```bash
gnome-extensions enable dynamic-music-pill@andbal
```

### Real-Time Visualizer (optional)

The Real-Time visualizer mode requires the `cava` package to be installed.

| Distribution | Command |
|---|---|
| Ubuntu / Debian | `sudo apt install cava` |
| Fedora | `sudo dnf install cava` |
| Arch Linux | `sudo pacman -S cava` |

---

### Contributing a Translation

Translations are managed on Weblate. No coding knowledge is required.

1. Click the badge below to visit the translation page.
2. Sign in with your GitHub account.
3. Select your language and start translating.

[![Translation status](https://hosted.weblate.org/widgets/dynamic-music-pill/-/svg-badge.svg)](https://hosted.weblate.org/engage/dynamic-music-pill/)


---

<p align="center">
  <img src="screenshots/how-it-works.svg" alt="Dynamic Music Pill" width="100%">
</p>

## Configuration

The Preferences window is organized into five tabs.

---

### Tab 1 — Main Pill

<p align="center">
  <img src="screenshots/main.png" width="400">
</p>

#### General Settings




| Setting | Description |
|---|---|
| Always ON | Retains the last known track and keeps the pill visible after the media player is closed. |
| Show Album Art | Displays the cover art thumbnail inside the pill. |
| Fallback Album Art | Sets a custom PNG or JPEG image to show when the current track provides no album art. |
| Enable Scroll Controls | Enables track, volume, or player switching via scroll wheel or touchpad gestures. |
| Scroll Action | What scrolling does: **Change Track**, **Change Volume**, or **Switch Player**. |
| Invert Scroll Animation | Reverses the direction of the visual jump animation on scroll (Natural vs. Traditional). |
| Invert Scroll Direction | Swaps the up/down mapping for track skipping and volume adjustment. |
| Scrolling Text | Animates long track titles and artist names that exceed the pill's width. |
| Lyrics Display | Shows real-time synchronized lyrics for the current track. |
| Lyrics Fade-in Effect | Smoothly fades in each new lyric line as it becomes active. |
| Fade Duration | Duration of the lyric fade-in transition in milliseconds (50–2000 ms). |
| Tablet Mode Controls | Overlays media buttons directly on the pill: **Off**, **Skip Only**, **Play/Pause Only**, or **All Controls**. |
| Inline Artist | Switches to a combined "Title • Artist" format when the pill is narrow. |
| Compact Mode (Hide Text) | Hides the title and artist text entirely for a minimal pill appearance. |

#### Mouse Actions

Each of the five interaction types can be assigned one of the following actions: **None**, **Play/Pause**, **Next Track**, **Previous Track**, **Open Player App**, **Close Player App**, **Open Pop-Up Menu**, **Select Player**, **Open Settings**.

| Setting | Description |
|---|---|
| Left Click | Action triggered by a single left-click on the pill. |
| Double Click | Action triggered by a double left-click on the pill. |
| Middle Click | Action triggered by a middle-click on the pill. |
| Right Click | Action triggered by a right-click on the pill. |
| Hover Action | Action triggered when the cursor rests over the pill. |
| Hover Delay | Time in milliseconds before the Hover Action fires after the cursor enters the pill (0–3000 ms). |

---

### Tab 2 — Pop-up Menu

<p align="center">
  <img src="screenshots/popup.png" width="400">
</p>

| Setting | Description |
|---|---|
| Rotate Vinyl | Spins the album art like a vinyl record while music is playing. Pauses on playback pause. |
| Rotation Speed | Speed of the vinyl spin animation (1 = slowest, 50 = fastest, default 10). |
| Enable Shadow | Adds a drop shadow behind the pop-up menu panel. |
| Close on Mouse Leave | Automatically hides the pop-up when the cursor moves outside it. |
| Follow Custom Background Color | Applies the pill's custom background color to the pop-up (requires Custom Colors enabled). |
| Follow Custom Text Color | Applies the pill's custom text color to the pop-up (requires Custom Colors enabled). |
| Follow Transparency | Inherits the pill's background opacity for the pop-up background. |
| Follow Border Radius | Inherits the pill's corner radius for the pop-up menu border. |
| Show Vinyl | Displays the album art image in the pop-up. |
| Square Vinyl Image | Shows the album art as a square instead of a circle. Disables vinyl rotation. |
| Show Shuffle and Loop | Displays shuffle and repeat toggle buttons in the pop-up controls. |
| Enable Custom Buttons | Adds up to two extra buttons to the pop-up controls row. |
| Custom Button 1 Action | Action for the first custom button: **None**, **Volume**, **Seek Step**, **Audio Output**, **Sleep Timer**, **Playback Speed**, or **Recently Played**. |
| Custom Button 2 Action | Action for the second custom button: **None**, **Volume**, **Seek Step**, **Audio Output**, **Sleep Timer**, **Playback Speed**, or **Recently Played**. |
| Show Player Selector | Shows active player icons at the top of the pop-up for one-click player switching. |
| Use Custom Width | Disables dynamic pop-up sizing and uses a fixed width instead. |
| Custom Width Value | Fixed width for the pop-up menu in pixels (260–800 px). |
| Show Visualizer in Pop-up | Displays the audio visualizer inside the pop-up menu. |
| Hide Pill Visualizer | Hides the main pill's visualizer when the pop-up is open, creating a visual transfer effect. |
| Popup Visualizer Bar Count | Number of bars shown in the pop-up visualizer (2–64). |
| Popup Visualizer Bar Width | Width of each bar in the pop-up visualizer in pixels (1–20 px). |
| Popup Visualizer Height | Maximum height of the pop-up visualizer in pixels (20–200 px). |

---

### Tab 3 — Style & Layout

<p align="center">
  <img src="screenshots/style.png" width="400">
</p>

#### Visualizer and Shape



| Setting | Description |
|---|---|
| Visualizer Animation | **Off**, **Wave** (smooth), **Beat** (jumpy bars), or **Real-Time** (requires `cava`). |
| Visualizer Bar Count | Number of bars in the pill visualizer (2–32). |
| Visualizer Bar Width | Thickness of each bar in pixels (1–10 px). |
| Visualizer Height | Maximum height of the visualizer, auto-clamped to pill height (10–100 px). |
| Visualizer Margin | Gap between the track text and the visualizer animation (0–50 px). |
| Outer Edge Margin | Padding before the album art and after the visualizer at the pill's outer edges (0–50 px). |
| Corner Radius | Border radius of the pill: 0 = fully square, 50 = full pill shape. |
| Show Pill Outline | Displays a subtle border around the main pill widget. |

#### Background and Transparency

| Setting | Description |
|---|---|
| Enable Transparency | Switches from the solid theme background to a transparent custom look. |
| Background Opacity | Strength of the background fill transparency (0–100). |
| Apply to Album Art | Extends the transparency to the album art thumbnail. |
| Apply to Text | Extends the transparency to the track title and artist name. |
| Apply to Visualizer | Extends the transparency to the visualizer animation. |

#### Main Pill Shadow

| Setting | Description |
|---|---|
| Enable Shadow | Adds a drop shadow behind the main pill widget. |
| Shadow Intensity | Opacity of the shadow (0–100). |
| Shadow Blur | Blur radius of the shadow in pixels (0–50). |

#### Custom Colors

| Setting | Description |
|---|---|
| Sync GNOME Accent Color | Dynamically changes the GNOME Shell system accent color to match the album art's dominant color. |
| Use Custom Colors | Enables manual color overrides, disabling the adaptive color engine. |
| Background Color | Fixed pill background color (color picker). |
| Text Color | Fixed text color for track title and artist name (color picker). |

#### Positioning

| Setting | Description |
|---|---|
| Container Target | Where the pill is hosted: **Dock**, **Panel: Left Box**, **Panel: Center Box**, or **Panel: Right Box**. |
| Dynamic Width | Auto-adjusts pill width to fit the track title; the configured width acts as the maximum. |
| Alignment Preset | How the pill aligns in its container: **Manual Index**, **First (Start)**, **Center**, or **Last (End)**. |
| Manual Index Position | Explicit position index in the container (0 = first). Only active when Alignment Preset is Manual Index. |
| Vertical Offset (Y) | Shifts the pill up (negative) or down (positive) in pixels (−30 to +30). |
| Horizontal Offset (X) | Shifts the pill left (negative) or right (positive) in pixels (−50 to +50). |

#### Dimensions — Dock Mode

| Setting | Range | Description |
|---|---|---|
| Album Art Size | 16–48 px | Size of the album art thumbnail. |
| Widget Width | 100–600 px | Total width of the pill. |
| Widget Height | 32–100 px | Total height of the pill. |

#### Dimensions — Panel Mode

| Setting | Range | Description |
|---|---|---|
| Album Art Size | 14–32 px | Size of the album art thumbnail. |
| Widget Width | 100–600 px | Total width of the pill. |
| Widget Height | 20–60 px | Total height of the pill. |

---

### Tab 4 — System & Reset

<p align="center">
  <img src="screenshots/system.png" width="400">
</p>

#### System

| Setting | Description |
|---|---|
| Hide Default GNOME Player | Removes the built-in GNOME media controls widget from the Quick Settings panel. |
| Game Mode | Automatically disables the visualizer and all animations when a fullscreen application is focused. Re-enables when the fullscreen app closes. |
| Slow Player Workaround | Adds a slight delay to track change handling to fix sync issues with slower players. |
| Player Filter Mode | Controls which media players the extension responds to: **Off (Allow All)**, **Blacklist (Exclude listed)**, or **Whitelist (Only allow listed)**. |
| Filtered Players | Comma-separated list of MPRIS app names to include or exclude. Active players are detected live via D-Bus and can be added with one click. |

#### App ID Mapping

When the extension cannot automatically identify a media player's window for the Open/Close App actions, a manual mapping table allows pairing the MPRIS player name to its correct window App ID.

Running players are detected live via D-Bus. Clicking **Use This** next to a detected player adds it to the mapping table. You then type in the correct App ID and save. Saved mappings can be edited in-place or deleted individually.

To find a player's App ID: press `Alt+F2`, type `lg`, open the **Windows** tab, and look at the `wmclass:` or `app:` field for the player window. Remove the `.desktop` suffix if present.

Common App ID examples:

| Player | App ID |
|---|---|
| Spotify (Flatpak) | `com.spotify.Client` |
| VLC | `vlc` |
| YouTube Music (web app) | `youtube-music` |
| High Tide | `io.github.nokse22.high-tide` |
| Chromium | `chromium` |
| Firefox | `firefox` |

#### Backup & Restore

| Action | Description |
|---|---|
| Export Settings | Serializes the entire current configuration to a `.json` file at a user-chosen path. |
| Import Settings | Loads a previously exported `.json` file and applies all stored settings instantly. |
| Factory Reset | Resets every setting to its default value. This action cannot be undone. |

---

<p align="center">
  <img src="screenshots/about.png" width="400">
</p>

---

## Support the Project

<div align="center">

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/andbal)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-red?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/andbal)

</div>

---
## Check out this one too:)
https://github.com/Andbal23/extension-profiles <br>
https://github.com/Andbal23/timed-do-not-disturb
---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Andbal23/dynamic-music-pill&type=Date)](https://star-history.com/#Andbal23/dynamic-music-pill&Date)

---

## License

This project is licensed under the [GPL-3.0 License](LICENSE).

---

<p align="center">Made with ❤️ for the GNOME community.</p>
