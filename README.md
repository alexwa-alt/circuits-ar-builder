# Circuit explorer kit

Each component is printed on its own A4 sheet. Students lay the sheets out like a circuit diagram, point a phone, iPad or laptop camera at them, and see the 3D circuit with moving charges, glowing bulbs and working meters. There is also a 3D view with no camera, where sheets can be dragged around a virtual table.

## Files

- `index.html`, `app.js` – the app
- `kit.pdf` – all 9 sheets, one per A4 page, ready to print
- `sheets/sheet-0.png` … `sheet-8.png` – the sheet images (also used in the 3D view)
- `targets.mind` – tracking data for all 9 sheets, in this order:
  0 Cell, 1 Switch, 2 Bulb A, 3 Bulb B, 4 Bulb C, 5 Resistor, 6 Variable resistor, 7 Ammeter, 8 Voltmeter

## Put it on GitHub Pages

If you already have the earlier version online, delete its old files first (or make a new repository).

1. In your repository choose **Add file → Upload files**. Drag in `index.html`, `app.js`, `kit.pdf`, `targets.mind`, `README.md` and the whole `sheets` folder. Commit.
2. **Settings → Pages** should still be set to "Deploy from a branch", **main**, **/(root)**.
3. The page is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/` after a minute or two.

## Printing at A5 (or any size)

No rebuild is needed. Tracking and the connection rules are measured in sheet widths, not centimetres, so the same files work at any size. Two rules:

- **Print every sheet at the same scale.** Mixing A4 and A5 sheets in one circuit will confuse the distances.
- For A5, either print `kit.pdf` on A5 paper with "Fit to page", or print on A4 with **2 pages per sheet** and cut each page in half.

Smaller sheets just mean holding the camera closer.

## How students use it

- Lay sheets out like a circuit diagram. Each sheet has a terminal dot at each end.
- **Dots within about one sheet-width of each other join up automatically**, including round corners. A simple loop of sheets needs no added wires.
- If the circuit isn't complete, a flashing amber line shows the two loose dots that are nearest each other, and the hint names them. Slide those sheets closer, or tap both dots to add a wire.
- Once the circuit is complete, tap **Lock connections** so camera wobble can't break it. Unlock to rearrange.
- **To add a wire,** tap one dot then another on screen (useful for corners, parallel branches and meters). Tap the same pair again to remove it.
- Dot colours: green = connected, amber = loose, white = selected.
- The app remembers where each sheet is, so the camera doesn't need to see every sheet at once. Keep at least one already-found sheet in view when bringing in a new one.
- Ammeter and voltmeter sheets show their reading on a 3D display. Their red + terminal works like a real meter: connect it the wrong way round and the reading goes negative. An ammeter connected across a component shorts it out, as in real life.
- If students move sheets around a lot, **Forget layout** starts afresh.

## Tips for reliable tracking

- Print in colour if you can, on matt paper, and keep the patterned areas uncovered.
- Good, even lighting helps. Avoid glare from windows.
- **Scan close, then step back.** Sheets are recognised most reliably when each one fills about a quarter of the screen. Start close to one sheet and sweep slowly across the layout, keeping one already-found sheet in view as each new one comes in. Once every sheet is found, the whole circuit stays in place and you can pull back to see it all.
- Hold the device so each sheet takes up at least a fifth of the screen width.
- About six sheets can be tracked at once; more will still be remembered.

## Changing the sheets

`targets.mind` has to match the sheet images exactly, in the order above. If you edit a sheet image, recompile all nine together (in order) at https://hiukim.github.io/mind-ar-js-doc/tools/compile and replace `targets.mind`.
