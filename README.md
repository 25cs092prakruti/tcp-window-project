# TCP Receiver Window Bottleneck Experiment - Website

## Structure
```
tcp-window-project/
  index.html      page content and sections
  css/style.css   theme and layout
  js/main.js      simulation, charts, 3D scenes
  images/         (create this) put your Wireshark screenshots here
```

## Run locally
1. Open a terminal in `tcp-window-project/`.
2. Run `python3 -m http.server 8000`.
3. Visit http://localhost:8000 in Chrome or Firefox.
(Double-clicking index.html also works.)

Three.js loads from the cdnjs CDN (free, no API key). If it cannot load, the page shows a text fallback, and the HUD and 2D charts still work. For fully offline use, download three.min.js (r128) into `js/` and change the script tag in index.html.

## Add your Wireshark screenshots
Save images in `images/`, then replace each `<div class="ph">` in the Wireshark section with `<img src="images/your-file.png" alt="description" style="max-width:100%">`.

## Recording the narrated demo (10-15 min)
1. Use OBS Studio (free) with a Window or Browser capture, 1080p, 30 fps, and your microphone. On Ubuntu, GNOME's screen recorder (Ctrl+Shift+Alt+R) also works.
2. Open the site full screen (F11) and scroll in nav order: Intro, Theory, Simulation, Results, Graphs, Wireshark, Tools, Conclusion.
3. Suggested timing: intro 1 min, theory 3, simulation 3 (switch Small then Large, point out the zero-window pause and resume), results and graphs 2, Wireshark 3 (show your screenshots), conclusion 1.
4. State clearly that the simulation is conceptual and that 0.89 / 17.27 Mbps and 37 / 32 events are your measured results.
5. Do a short test recording to check audio levels first.
