export const GEAR_PRODUCTION_PUBLIC_ORIGIN='https://postandin.com';
export const GEAR_STAGING_PUBLIC_ORIGIN='https://postandin-gear-staging.pages.dev';
export const GEAR_PRODUCTION_ADMIN_ORIGIN='https://gear-admin.postandin.com';
export const GEAR_STAGING_ADMIN_ORIGIN='https://gear-admin-staging.postandin.com';

const PUBLIC_ORIGINS=new Set([GEAR_PRODUCTION_PUBLIC_ORIGIN,GEAR_STAGING_PUBLIC_ORIGIN]);
const ADMIN_ORIGINS=new Set([GEAR_PRODUCTION_ADMIN_ORIGIN,GEAR_STAGING_ADMIN_ORIGIN]);

function configuredOrigin(env,name,fallback,allowed){
  if(env?.[name]===undefined)return fallback;
  return typeof env[name]==='string'&&allowed.has(env[name])?env[name]:null;
}

export const isGearPublicOrigin=value=>typeof value==='string'&&PUBLIC_ORIGINS.has(value);
export const isGearAdminOrigin=value=>typeof value==='string'&&ADMIN_ORIGINS.has(value);
export const gearPublicOrigin=env=>configuredOrigin(env,'GEAR_PUBLIC_ORIGIN',GEAR_PRODUCTION_PUBLIC_ORIGIN,PUBLIC_ORIGINS);
export const gearAdminOrigin=env=>configuredOrigin(env,'GEAR_ADMIN_ORIGIN',GEAR_PRODUCTION_ADMIN_ORIGIN,ADMIN_ORIGINS);
