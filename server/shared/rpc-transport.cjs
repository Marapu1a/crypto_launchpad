// One gate reservation permits one HTTP attempt. Retry in the service loop,
// never inside ethers; redirects must not escape the endpoint allowlist.
function boundedRequest(request){
 request.setThrottleParams({maxAttempts:1});
 request.retryFunc=async()=>false;
 const getUrl=request.getUrlFunc;
 request.getUrlFunc=async(...args)=>{
  const response=await getUrl(...args);
  if([301,302,307,308].includes(response.statusCode))throw Error('RPC redirects are disabled');
  return response;
 };
 return request;
}
module.exports={boundedRequest};
