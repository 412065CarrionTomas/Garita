/** Abre la app de mapas con el recorrido hasta unas coordenadas (Google Maps o la del sistema). */
export const directionsUrl = ({ latitude, longitude }: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
