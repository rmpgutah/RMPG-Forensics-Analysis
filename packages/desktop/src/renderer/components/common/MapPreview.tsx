import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

/**
 * One pin on the map. `label` becomes the popup title; `timestamp` and
 * `source` show as secondary lines if present. Lat/Lon are required.
 */
export interface MapPoint {
  latitude: number;
  longitude: number;
  label?: string;
  timestamp?: string;
  source?: string;
}

interface MapPreviewProps {
  points: MapPoint[];
  /**
   * Pixel height of the map container. Map auto-fits horizontally.
   * Default 480px is comfortable for most pages without crowding.
   */
  height?: number;
  /**
   * If true (default), large point sets are clustered for performance.
   * Disable for small static datasets where every pin should always be
   * visible regardless of zoom.
   */
  cluster?: boolean;
}

/**
 * Lightweight Leaflet map preview with marker clustering.
 *
 * Why this design:
 * - **Vanilla Leaflet, not react-leaflet**: react-leaflet's <MapContainer>
 *   recreates the map instance on prop changes which is the #1 cause of
 *   "lag with overlay" complaints — every re-render of the parent triggers
 *   a teardown/rebuild. Holding the L.Map instance in a ref and only
 *   updating the marker layer keeps the map smooth even when the parent
 *   re-renders for unrelated state.
 * - **MarkerClusterGroup**: thousands of forensic GPS points (e.g. a
 *   week's worth of Significant Locations) would tank pan/zoom without
 *   clustering — leaflet.markercluster batches markers into expandable
 *   clusters at low zoom and shows individuals when zoomed in.
 * - **fitBounds on each points-update**: zooms to the smallest bbox that
 *   contains all points, with a 0.5° padding so single-point datasets
 *   don't render at world-scale.
 *
 * Tile source is OpenStreetMap — no API key, no quota for forensic use.
 */
export const MapPreview: React.FC<MapPreviewProps> = ({
  points,
  height = 480,
  cluster = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // One-time map creation — never re-created across re-renders.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      preferCanvas: true, // canvas renderer is materially faster for clusters
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Update the marker layer whenever the points list changes. Replace the
  // whole layer instead of diffing — for a few-thousand-point dataset it's
  // measurably faster than computing add/remove diffs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (points.length === 0) {
      map.setView([20, 0], 2);
      return;
    }

    const layer: L.LayerGroup = cluster
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (L as any).markerClusterGroup({
          chunkedLoading: true,           // adds markers in chunks during init
          spiderfyOnMaxZoom: true,        // expand overlapping pins at max zoom
          showCoverageOnHover: false,     // skip the convex-hull polygon (perf)
          maxClusterRadius: 60,
        })
      : L.layerGroup();

    for (const p of points) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const marker = L.marker([p.latitude, p.longitude]);
      const popupLines = [
        p.label ? `<strong>${escapeHtml(p.label)}</strong>` : '',
        `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`,
        p.timestamp ? `<span style="color:#888">${escapeHtml(p.timestamp)}</span>` : '',
        p.source ? `<span style="color:#888;font-size:11px">${escapeHtml(p.source)}</span>` : '',
      ].filter(Boolean).join('<br>');
      marker.bindPopup(popupLines);
      layer.addLayer(marker);
    }
    layer.addTo(map);
    layerRef.current = layer;

    // Zoom to fit all points; padding keeps single-pin datasets readable.
    const bounds = L.latLngBounds(
      points
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map((p) => [p.latitude, p.longitude] as [number, number])
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { maxZoom: 16, animate: false });
    }
  }, [points, cluster]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%', borderRadius: 6 }}
      className="border border-[var(--border-color)]"
    />
  );
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
