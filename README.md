<table align="center"> <tr> <td align="center" style="border: none !important;"> <img src="screenshots/logo.png" width="90"> </td> <td align="center" style="border: none !important;"> <h1 style="margin: 0; font-size: 45px;">Dynamic Music Pill</h1> </td> </tr> </table>
A dynamic, elegant, and highly customizable music widget for GNOME Shell. It brings a pill-shaped media controller with a live waveform visualizer directly to your Dash or Panel.
<br></br>
<p align="center">
  <img src="screenshots/picture.png" alt="Dynamic Music Pill Logo" width="400">
    
</p>


---
<div align="center">
  
![GitHub all releases](https://img.shields.io/github/downloads/Andbal23/dynamic-music-pill/total?style=flat-square&logo=github&label=GitHub%20Downloads) ![Views](https://komarev.com/ghpvc/?username=Andbal23&repo=dynamic-music-pill&label=Views&color=green) ![GNOME Shell](https://img.shields.io/badge/GNOME-45%20--%2049-blue?logo=gnome&logoColor=white) ![GitHub License](https://img.shields.io/github/license/Andbal23/dynamic-music-pill)
 [![Stars](https://img.shields.io/github/stars/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/stargazers) [![Watchers](https://img.shields.io/github/watchers/Andbal23/dynamic-music-pill?style=social)](https://github.com/Andbal23/dynamic-music-pill/watchers)
</div>

---
## ✨ Features

* **Dual Placement:** Supports both **Dash** and the **Panel** (Left, Center, and Right sections).
* **Adaptive Colors:** The widget's background and visualizer colors automatically adapt to the current track's album art.
* **Live Visualizer:** Real-time waveform or beat animation that reacts to your music.
* **🎮 Game Mode:** Automatically stop the visual and the scrolling when a fullscreen application is active to ensure maximum performance (FPS).
* **Smart Scrolling:** Long titles and artist names scroll smoothly to stay readable.
* **Customization:** Fine-tune width, height, offsets, corner radius, and shadow effects independently for both Dock and Panel modes. You can also enable or disable album art.
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
## 🌐 From GNOME Extensions Store

<p align="left">
  <a href="https://extensions.gnome.org/extension/9334/dynamic-music-pill/">
    <img alt="Get it on GNOME Extensions" width="228" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true"/>
  </a>
  <p align="left"
    
  ![GNOME Extension Version](https://img.shields.io/gnome-shell-extension/v/9334)
![GNOME Extension Rating](https://img.shields.io/gnome-shell-extension/rating/9334)
  </p>
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

---

## 🛠️ Configuration
<p align="center">
<img src="screenshots/setting.png" width="400">
</p>

Open the **Settings** to customize the appearance:
* **Position Mode:** Choose between Manual Index, Start, Center, or End alignment.
* **Visualizer Style:** Toggle between "Wave" (smooth) or "Beat" (energetic) modes.
* **Target Container:** Switch between Dock and Top Panel instantly.
* **Customize the look:** Height, width, offstets, border radius and more.
* **Album art** You can turn it off or on.
---
<div align="center">
  
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/andbal)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-red?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/andbal)
</div>

---

## Stars

[![Star History Chart](https://api.star-history.com/svg?repos=Andbal23/dynamic-music-pill&type=Date)](https://star-history.com/#Andbal23/dynamic-music-pill&Date)
  ---
## 📜 License

This project is licensed under the GPL-3.0 License.

---
<p align="center">
  Made with ❤️ for the GNOME community.
</p>
