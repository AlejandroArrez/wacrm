import { NextResponse } from 'next/server'
import { getDeploymentBranding } from '@/lib/branding/server'

/**
 * Public: the deployment's CRM name, logo and icon, for the login page
 * (shown before sign-in). Only display data — no ids, no account name.
 */
export async function GET() {
  const branding = await getDeploymentBranding()
  return NextResponse.json(branding, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  })
}
