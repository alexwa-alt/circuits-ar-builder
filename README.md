# Circuit explorer

A 3D series circuit that appears on top of a printed worksheet when viewed through a phone, iPad or laptop camera. It also has a 3D view that works without a camera.

## Files

- `index.html` – the page
- `app.js` – circuit solver, 3D models, 3D view and camera (AR) view
- `worksheet.png` – the worksheet image (also used as the paper in the 3D view)
- `worksheet.pdf` – A4 landscape version for printing
- `targets.mind` – the tracking data compiled from `worksheet.png`

## Put it on GitHub Pages

1. Create a free account at github.com and make a new **public** repository (for example `circuit-explorer`).
2. Choose **Add file → Upload files**, drag in all five files, and click **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, choose **main** and **/(root)**, and click **Save**.
4. After a minute or two the page is live at `https://YOUR-USERNAME.github.io/circuit-explorer/`.

## Using it in class

- Print `worksheet.pdf` in colour or black and white. Keep the patterned border: the camera uses it to lock on.
- Share the link (or a QR code of it). Students tap **Start camera** and allow camera access.
- Laptops, or any device where the camera is blocked, can use **3D view without camera**.
- To link it from Google Sites, insert a button or text link to the GitHub Pages address. (An embed won't be allowed to use the camera.)

## If you change the worksheet image

`targets.mind` must match the printed image exactly. If you edit `worksheet.png`, recompile it with the MindAR compiler at
https://hiukim.github.io/mind-ar-js-doc/tools/compile, download the result, rename it `targets.mind`, and upload it in place of the old one. Keep the circuit in the same place on the sheet, or update the layout numbers at the top of `app.js`.

## Notes

- Opening `index.html` directly from your computer won't work; it needs to be served over https (GitHub Pages does this).
- Libraries load from the jsDelivr CDN: three.js 0.160.0 and MindAR 1.2.5.
