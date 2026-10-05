/** Visual diagnosis only: never enable sender styles in the real sanitizer. */
export function mobileVisualFixtures() {
  return [
    {name:"MOBILE_FIXED_COLUMNS",end:"ACTUAL_END_COLUMNS",html:'<table width="800" style="width:800px"><tr><td width="400" style="padding:24px"><h1 style="font-size:48px">Synthetic large heading</h1><p>First fixed column.</p></td><td width="400" style="padding:24px"><h2 style="font-size:32px">Second column</h2><p>Second fixed column.</p></td></tr></table><p>ACTUAL_END_COLUMNS</p>'},
    {name:"MOBILE_VISIBILITY_RULES",end:"ACTUAL_END_VISIBILITY",html:'<style>.desktop{display:block}.mobile{display:none}@media(max-width:600px){.desktop{display:none}.mobile{display:block}}</style><div class="desktop"><a href="https://example.invalid/details">Synthetic repeated link</a></div><div class="mobile"><a href="https://example.invalid/details">Synthetic repeated link</a></div><p>ACTUAL_END_VISIBILITY</p>'},
  ];
}
