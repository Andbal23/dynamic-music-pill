# 🎵 Dynamic Music Pill

A dynamic, elegant, and highly customizable music widget for GNOME Shell. It brings a pill-shaped media controller with a live waveform visualizer directly to your Dash or Panel.

<p align="center">
  <img src="screenshots/picture.png" alt="Dynamic Music Pill Logo" width="400">
    
</p>

![Views](https://komarev.com/ghpvc/?username=Andbal23&repo=dynamic-music-pill&label=Views&color=blue)

![GitHub All Releases](https://img.shields.io/github/downloads/Andbal23/dynamic-music-pill/total?label=Downloads&color=orange)

---

## ✨ Features

* **Dual Placement:** Supports both **Dash** and the **Panel** (Left, Center, and Right sections).
* **Adaptive Colors:** The widget's background and visualizer colors automatically adapt to the current track's album art.
* **Live Visualizer:** Real-time waveform or beat animation that reacts to your music.
* **🎮 Game Mode:** Automatically hides the widget when a fullscreen application is active to ensure maximum performance (FPS).
* **Smart Scrolling:** Long titles and artist names scroll smoothly to stay readable.
* **Customization:** Fine-tune width, height, offsets, corner radius, and shadow effects independently for both Dock and Panel modes.
* **Controls:** You can skip or resume the media by clicking it or scroll for skip or rewind.

---

### 📸 Screenshots

| Dash-to-Dock Integration | Top Panel Mode |
|:---:|:---:|
| <img src="screenshots/playing.png" width="400"> | <img src="screenshots/panel.png" width="400"> |

### 🎬 Preview
<p align="center">
  <img src="screenshots/demo.gif" alt="Dynamic Music Pill Demo">
</p>

---

# 🚀 Installation

##  Manual Installation
From Source (GitHub)

## **1.** Clone the repository:

`
 git clone https://github.com/Andbal23/dynamic-music-pill.git 
`
## **2.** Go into the directory
`
cd dynamic-music-pill
`
`

## **3.** Create the directory
`
mkdir -p ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal
`

## **4.** Copy files
`
cp -r * ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal/
`

## **5.** Compile schemas
`
cd ~/.local/share/gnome-shell/extensions/dynamic-music-pill@andbal
`
<br>
`
glib-compile-schemas schemas/
`

## **6.**  Restart GNOME Shell 
(`Alt+F2`, type `r`, then `Enter`) or log out/in if you are on Wayland.
## **7.**  Enable the extension 
via **GNOME Extensions** or **Extension Manager** or `gnome-extensions enable dynamic-music-pill@andbal`

## 🌐 From GNOME Extensions Store
Search for **Dynamic Music Pill** on the [GNOME Extensions website](https://extensions.gnome.org/extension/9334/dynamic-music-pill/).
![GNOME Extension Version](https://img.shields.io/gnome-shell-extension/v/9334)
![GNOME Extension Rating](https://img.shields.io/gnome-shell-extension/rating/9334)

---

## 🛠️ Configuration

Open the **Settings** to customize the appearance:
* **Position Mode:** Choose between Manual Index, Start, Center, or End alignment.
* **Visualizer Style:** Toggle between "Wave" (smooth) or "Beat" (energetic) modes.
* **Target Container:** Switch between Dock and Top Panel instantly.
* **Customize the look:** Height, width, offstets, border radius and more.

---
[![Stars](https://img.shields.io/github/stars/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/stargazers)
[![Watchers](https://img.shields.io/github/watchers/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/watchers)
---
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/andbal)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-red?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/andbal)
---
## 📜 License

This project is licensed under the GPL-3.0 License.

---
<p align="center">
  Made with ❤️ for the GNOME community.
</p>
