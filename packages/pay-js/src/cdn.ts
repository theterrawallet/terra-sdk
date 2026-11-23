/** CDN entry (IIFE): exposes window.TerraPay for <script> tag users. */
import { TerraPay } from "./index.js";

const g = globalThis as { TerraPay?: typeof TerraPay };
if (!g.TerraPay) g.TerraPay = TerraPay;
