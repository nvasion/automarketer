import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { accessTokenStore } from '../models/accessTokenStore.js';

const router = Router();
router.use(requireAuth);

export interface LinkedInPage {
  urn: string;
  name: string;
  type: 'person' | 'organization';
}

/**
 * GET /api/linkedin/pages
 *
 * Returns the list of LinkedIn identities the authenticated user can post as:
 *   - Their personal profile (always included when connected)
 *   - Any organization pages they administer (requires r_organization_admin scope)
 *
 * Gracefully handles missing org-admin scope: returns only the personal profile
 * rather than erroring, so users with the basic w_member_social scope still see
 * a useful result. The org section is silently skipped on 403 (no permission).
 */
router.get('/pages', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const accessToken = await accessTokenStore.getValidAccessToken(userId, 'linkedin');
  if (!accessToken) {
    res.status(401).json({
      error: 'Not connected to LinkedIn. Please connect your account in Settings.',
      code: 'MISSING_TOKEN',
    });
    return;
  }

  const pages: LinkedInPage[] = [];

  // ── Personal profile ────────────────────────────────────────────────────────
  // Resolve the member's name and URN via OpenID Connect userinfo. The URN may
  // already be in the token store (set during OAuth); userinfo fills in the name.
  let personUrn = accessTokenStore.getAuthorId(userId, 'linkedin') ?? undefined;
  let personName = 'Personal Profile';

  try {
    const userInfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userInfoRes.ok) {
      const info = (await userInfoRes.json()) as {
        sub?: string;
        name?: string;
        given_name?: string;
        family_name?: string;
      };
      if (info.sub && !personUrn) {
        personUrn = `urn:li:person:${info.sub}`;
      }
      const displayName =
        info.name ?? [info.given_name, info.family_name].filter(Boolean).join(' ');
      if (displayName) personName = displayName;
    }
  } catch (err) {
    console.warn(
      `[linkedin] userinfo fetch failed for user=${userId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (personUrn) {
    pages.push({ urn: personUrn, name: personName, type: 'person' });
  } else {
    console.warn(
      `[linkedin] Could not resolve personal profile URN for user=${userId} — ` +
        'returning empty pages list',
    );
  }

  // ── Organization pages ──────────────────────────────────────────────────────
  // Fetching the user's administered organizations requires the r_organization_admin
  // scope, which is only available when the "Organization Access" LinkedIn product
  // has been added to the OAuth app. A 403 response means the scope is absent —
  // that is expected for apps with only the basic w_member_social scope.
  try {
    const aclRes = await fetch(
      'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );

    if (aclRes.ok) {
      const aclData = (await aclRes.json()) as {
        elements?: Array<{ organizationalTarget?: string }>;
      };

      const orgUrns = (aclData.elements ?? [])
        .map((el) => el.organizationalTarget)
        .filter(
          (urn): urn is string =>
            typeof urn === 'string' && urn.startsWith('urn:li:organization:'),
        );

      if (orgUrns.length > 0) {
        // Resolve organization display names in a single batched request.
        const orgIds = orgUrns
          .map((urn) => urn.replace('urn:li:organization:', ''))
          .filter(Boolean);

        try {
          const orgsRes = await fetch(
            `https://api.linkedin.com/v2/organizations?ids=List(${orgIds.join(',')})&fields=id,localizedName`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-Restli-Protocol-Version': '2.0.0',
              },
            },
          );

          if (orgsRes.ok) {
            const orgsData = (await orgsRes.json()) as {
              results?: Record<string, { id?: number; localizedName?: string }>;
            };

            for (const urn of orgUrns) {
              const orgId = urn.replace('urn:li:organization:', '');
              const org = orgsData.results?.[orgId];
              pages.push({
                urn,
                name: org?.localizedName ?? `Organization ${orgId}`,
                type: 'organization',
              });
            }
          } else {
            // Name lookup failed — add with generic names so the URN is still usable.
            for (const urn of orgUrns) {
              const orgId = urn.replace('urn:li:organization:', '');
              pages.push({ urn, name: `Organization ${orgId}`, type: 'organization' });
            }
          }
        } catch (err) {
          console.warn(
            `[linkedin] Organization name lookup failed for user=${userId}:`,
            err instanceof Error ? err.message : String(err),
          );
          for (const urn of orgUrns) {
            const orgId = urn.replace('urn:li:organization:', '');
            pages.push({ urn, name: `Organization ${orgId}`, type: 'organization' });
          }
        }
      }
    } else if (aclRes.status !== 403) {
      // 403 = missing r_organization_admin scope (expected for basic apps).
      // Any other non-OK status is worth logging.
      console.warn(
        `[linkedin] Organization ACL fetch returned HTTP ${aclRes.status} for user=${userId}`,
      );
    }
  } catch (err) {
    // Non-fatal: org pages are optional; personal profile is sufficient.
    console.warn(
      `[linkedin] Organization page fetch failed for user=${userId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  console.log(
    `[linkedin] pages response for user=${userId}: ${pages.length} option(s) ` +
      `(${pages.map((p) => p.type).join(', ')})`,
  );
  res.json({ pages });
});

export default router;
