import { useEffect, useState } from 'react';
import { colors } from '@garita/tokens';

interface Palette {
  land: string;
  park: string;
  water: string;
  bank: string;
  road: string;
  avenue: string;
  building: string;
  contour: string;
  label: string;
}

// Valores de maquetas/IMPLEMENTACION.md §6. Las etiquetas usan la tinta atenuada del tema.
const light: Palette = {
  land: '#EEF0F2',
  park: '#E0E8E4',
  water: '#D6E0EC',
  bank: '#E3E9F1',
  road: '#FFFFFF',
  avenue: '#FFFFFF',
  building: '#E1E5EA',
  contour: '#DFE3EA',
  label: colors.light.mutedForeground,
};
const dark: Palette = {
  land: '#121B2E',
  park: '#142A33',
  water: '#0C1322',
  bank: '#0F182A',
  road: '#1D2943',
  avenue: '#2B3A5C',
  building: '#182339',
  contour: '#1A2540',
  label: colors.dark.mutedForeground,
};

const color = (value: string) => [{ color: value }];

function build(p: Palette): google.maps.MapTypeStyle[] {
  return [
    { elementType: 'geometry', stylers: color(p.land) },
    { elementType: 'labels.text.fill', stylers: color(p.label) },
    { elementType: 'labels.text.stroke', stylers: color(p.land) },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: color(p.park) },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: color(p.building) },
    {
      featureType: 'landscape.natural.terrain',
      elementType: 'geometry',
      stylers: color(p.contour),
    },
    { featureType: 'water', elementType: 'geometry.fill', stylers: color(p.water) },
    { featureType: 'water', elementType: 'geometry.stroke', stylers: color(p.bank) },
    { featureType: 'road.local', elementType: 'geometry', stylers: color(p.road) },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: color(p.avenue) },
    { featureType: 'road.highway', elementType: 'geometry', stylers: color(p.avenue) },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  ];
}

export const lightMapStyle = build(light);
export const darkMapStyle = build(dark);

/** Tema según la clase `.dark` del documento (la pone ThemeProvider). */
export function useDark() {
  const read = () => document.documentElement.classList.contains('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(read());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
    };
  }, []);
  return dark;
}

/** Estilo del mapa según el tema; se pasa como `styles` (JSON local, sin mapId de la nube). */
export const mapStyle = (isDark: boolean) => (isDark ? darkMapStyle : lightMapStyle);
