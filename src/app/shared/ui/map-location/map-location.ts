import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  GEOAPIFY_URL,
  OSM_COPYRIGHT_URL,
  googleMapsSearchUrl,
  osmEmbedUrl,
  osmOpenUrl,
  placeCredits,
  toSafeMapLocation,
  validateEmbedUrl
} from '../../../core/models/proposal-location';

/**
 * Ubicación de un día o servicio: nombre, dirección, enlaces para abrirla y el mapa (de Google si se pegó su código, o de
 * OpenStreetMap si se eligió con «Buscar ubicación»; en ese caso se muestra siempre la atribución). Se usa en la vista previa y
 * en el editor. Valida lo que recibe (aunque ya venga validado) y arma el iframe con atributos fijos: el HTML pegado por
 * el asesor nunca llega aquí. El nombre, la dirección y el enlace se muestran aunque el mapa externo no cargue.
 */
@Component({
  selector: 'app-map-location',
  templateUrl: './map-location.html',
  styleUrl: './map-location.css'
})
export class MapLocation {
  private readonly sanitizer = inject(DomSanitizer);

  readonly location = input<unknown>(undefined);

  readonly safe = computed(() => toSafeMapLocation(this.location()));
  readonly link = computed(() => {
    const safe = this.safe();
    return safe ? googleMapsSearchUrl(safe) : null;
  });
  readonly isOsm = computed(() => !!this.safe()?.place);
  readonly osmLink = computed(() => osmOpenUrl(this.safe()?.place));
  readonly copyrightUrl = OSM_COPYRIGHT_URL;
  readonly geoapifyUrl = GEOAPIFY_URL;
  /** Atribuciones obligatorias del lugar: OpenStreetMap siempre; «Powered by Geoapify» si lo geocodificó Geoapify; otra fuente si la informó. */
  readonly credits = computed(() => placeCredits(this.safe()?.place));
  /**
   * bypassSecurityTrustResourceUrl SOLO sobre una URL que acaba de pasar la validación: la de inserción de Google
   * (validateEmbedUrl) o la que construye osmEmbedUrl a partir de un lugar válido. Nunca sobre texto del contenido.
   */
  readonly embedSrc = computed(() => {
    const safe = this.safe();
    const url = safe?.place ? osmEmbedUrl(safe.place) : validateEmbedUrl(safe?.embedUrl);
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
}
