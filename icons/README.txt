GRABIT APPLICATION ICONS

grabit.svg is the square master mark used for the favicon and in-app branding.
Platform PNGs are generated from this SVG for launchers that require raster
icons; the SVG is also listed in the web manifest where supported.
Use square, opaque PNGs for Android and Apple launch icons; let each platform
apply its own circle, squircle, or other launcher mask. Do not bake a white
border or a circular crop into the primary icon.

Android maskable PNGs keep the mark inside the adaptive-icon safe area so
launchers can crop the solid background without clipping the artwork. The
legacy round-icon filenames are square copies too; let the launcher choose
the shape instead of baking a circular border into the image.
