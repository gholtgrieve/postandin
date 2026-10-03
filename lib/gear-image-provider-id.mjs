const PROVIDER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isGearImageProviderId(value){
  return typeof value==='string'&&PROVIDER_ID.test(value);
}

export function requireGearImageProviderId(value,label='Provider ID'){
  if(!isGearImageProviderId(value))throw new TypeError(`${label} must be a lowercase UUID.`);
  return value;
}
