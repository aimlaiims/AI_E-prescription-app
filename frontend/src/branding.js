// Institution branding, in one place. The doctor's own details (name,
// qualification, registration no.) come from their login profile once that
// exists; until then the letterhead shows the institution only.
export const BRAND = {
  appName: "AIIMS E-Prescription",
  institution: "All India Institute of Medical Sciences, Raipur",
  footer: "AIIMS Raipur · AI Voice E-Prescription System",
  // JPEG (the source file was a JPEG named .png); it has a white background,
  // so the UI always shows it inside a white circle.
  logoUrl: "/aiims-logo.jpg",
};

let logoDataUri; // cached promise

// The print page opens in a blank window (and the records preview in an
// iframe srcdoc), where "/aiims-logo.jpg" can't resolve — so the logo is
// embedded as a data URI. Resolves to "" if it can't be loaded; the print
// then simply has no logo.
export function loadLogoDataUri() {
  logoDataUri ||= fetch(BRAND.logoUrl)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`logo ${res.status}`))))
    .then(
      (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        })
    )
    .catch(() => "");
  return logoDataUri;
}

// The print letterhead is built from the signed-in doctor's profile: see
// doctorLetterhead() in doctor.js.
