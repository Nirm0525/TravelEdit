import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Draggable } from 'gsap/Draggable';
import { InertiaPlugin } from 'gsap/InertiaPlugin';
import { SplitText } from 'gsap/SplitText';

let registered = false;

export function registerGsap(): typeof gsap {
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger, Draggable, InertiaPlugin, SplitText);
    registered = true;
  }
  return gsap;
}

export { gsap, ScrollTrigger, Draggable, InertiaPlugin, SplitText };
