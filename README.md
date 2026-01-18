# BalmeSnow

A webcam viewer for browsing time-lapse images from the La Clusaz ski resort webcam at Balme.

## Features

- **Image Navigation**: Browse timestamped webcam images using arrow keys or on-screen buttons
- **Magnifying Glass**: Zoom into images for detail (up to 8x zoom with mouse wheel)
- **Smart Navigation**: 
  - Arrow keys: Move one image forward/backward
  - Shift + Arrow: Jump to first image of day/afternoon (12h intervals)
  - Ctrl + Shift + Arrow: Jump 24 hours forward/backward
- **Auto-refresh**: Polls for new images every 30 seconds
- **Panorama Cropping**: Joins the edges of the 360° panorama to show the scene of interest
- **Image Preloading**: Preloads adjacent images for smooth navigation
- **Historical Browsing**: Navigate through past days when reaching the first image of the current day

## Usage

1. Open `index.html` in a web browser (or serve via local HTTP server: `python3 -m http.server 8000`)
2. The viewer loads the latest available images automatically
3. Use keyboard controls or on-screen buttons to navigate
4. Click the help icon (?) in the top-right corner for more information

## Data Source

Images and metadata are fetched from webcam-hd.com archives for the La Clusaz Balme webcam.

