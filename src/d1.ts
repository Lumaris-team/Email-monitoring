export function selectDbBindingNameForSubdomain(subdomain: string) {
  // Map subdomain to binding name. Extend this mapping as you add more D1 databases.
  // For now: any subdomain that contains 'services' maps to SERVICES_EMAIL.
  if (!subdomain) return 'SERVICES_EMAIL';
  if (subdomain.includes('services')) return 'SERVICES_EMAIL';
  return 'SERVICES_EMAIL';
}
