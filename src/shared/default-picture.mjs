// The picture the wall shows when nothing is playing: a render of the three
// toys on a studio floor (assets/default-picture.jpg, drawn by
// scripts/default-picture.mjs). Every window maps it in place of a video
// frame until there is one, and the effect thumbnails are shot over it.
let img = null;

/** The shared <img>, loading on first use. */
export function defaultPicture() {
  if (!img) {
    img = new Image();
    img.src = '/assets/default-picture.jpg';
  }
  return img;
}
