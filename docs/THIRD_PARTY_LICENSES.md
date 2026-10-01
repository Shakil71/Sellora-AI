# Third-party software

Sellora AI is built on open-source packages installed through npm. They stay under their own licenses and are not modified. This summary covers the packages that ship in the production build (about 550). Regenerate it before every release from `package-lock.json`.

| License | Packages | Notes |
| --- | ---: | --- |
| MIT (and MIT-0, MIT/X11) | ~420 | Permissive. |
| Apache-2.0 | ~50 | Permissive. |
| ISC | ~43 | Permissive. |
| BSD-2-Clause / BSD-3-Clause / BSD / 0BSD | ~15 | Permissive. |
| Unlicense, Blue Oak and similar | a few | Permissive. |
| LGPL-3.0-or-later | ~14 | `@img/sharp-libvips-*`, the prebuilt image-processing libraries used by Next.js image optimization. They are installed as separate binaries and are not modified or statically linked into Sellora AI. |
| CC-BY-4.0 | 1 | `caniuse-lite` (browser compatibility data). Attribution: data from caniuse.com, used under CC BY 4.0. |
| "UNKNOWN" in metadata | 5 | `buffers`, `busboy`, `png-js`, `streamsearch`, `thirty-two`: all published under the MIT license, the field is simply missing from their package metadata. |

Notable direct dependencies and their licenses: NestJS (MIT), Prisma (Apache-2.0), Next.js and React (MIT), Tailwind CSS (MIT), Radix UI (MIT), TanStack Query (MIT), Recharts (MIT), React Flow (MIT), dnd-kit (MIT), BullMQ (MIT), ioredis (MIT), Socket.IO (MIT), nodemailer (MIT-0), ExcelJS (MIT), mammoth (BSD-2-Clause), pdf-parse (MIT), Zod (MIT), lucide-react (ISC).

Fonts and images: the interface uses the Inter typeface, loaded through `next/font/google` and self-hosted at build time, under the SIL Open Font License 1.1. All illustrations, logos and screenshots in `apps/web/public` are original to this product.

No package in the production build uses a GPL or AGPL license.
