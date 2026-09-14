import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync=promisify(execFile);

export const prebuiltPythonMembers={
  os:"path listdir getcwd environ makedirs mkdir remove rename replace scandir stat walk open close read write getenv getpid cpu_count abort access chdir chmod chown curdir error execl execle execlp execlpe execv execve execvp execvpe extsep fdopen fork fspath getcwdb getgid getlogin getppid getuid kill linesep link lseek name pardir pathconf pathsep pipe popen putenv readlink removedirs renames rmdir sep spawnl spawnle spawnlp spawnlpe spawnv spawnve spawnvp spawnvpe strerror symlink system terminal_size times truncate ttyname umask uname unlink unsetenv urandom utime wait waitpid".split(" "),
  sys:"argv base_prefix byteorder copyright displayhook executable exit flags float_info getdefaultencoding getfilesystemencoding getprofile getrecursionlimit getsizeof gettrace hexversion implementation int_info intern is_finalizing maxsize meta_path modules path path_hooks path_importer_cache platform prefix ps1 ps2 pycache_prefix setprofile setrecursionlimit settrace stderr stdin stdout version version_info warnoptions".split(" "),
  pathlib:"Path PurePath PosixPath PurePosixPath WindowsPath PureWindowsPath".split(" "),
  json:"JSONDecodeError JSONDecoder JSONEncoder dump dumps load loads".split(" "),
  math:"acos acosh asin asinh atan atan2 atanh ceil comb copysign cos cosh degrees dist e erf erfc exp exp2 expm1 fabs factorial floor fmod frexp fsum gamma gcd hypot inf isclose isfinite isinf isnan isqrt lcm ldexp lgamma log log10 log1p log2 modf nan nextafter perm pi pow prod radians remainder sin sinh sqrt tan tanh tau trunc ulp".split(" "),
  re:"A ASCII DEBUG DOTALL I IGNORECASE L LOCALE M MULTILINE Match NOFLAG Pattern S Scanner T TEMPLATE U UNICODE VERBOSE X compile escape findall finditer fullmatch match purge search split sub subn".split(" "),
  itertools:"accumulate batched chain combinations combinations_with_replacement compress count cycle dropwhile filterfalse groupby islice pairwise permutations product repeat starmap takewhile tee zip_longest".split(" "),
  collections:"ChainMap Counter OrderedDict UserDict UserList UserString defaultdict deque namedtuple".split(" ")
};

export function pythonImportAliases(source){
  const aliases={};
  for(const match of source.matchAll(/^\s*import\s+([^#\n]+)/gm))for(const item of match[1].split(",")){const part=item.trim().match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?$/);if(part)aliases[part[2]||part[1].split(".")[0]]=part[1];}
  return aliases;
}

export function pythonMemberSuggestions(source,expression,prefix,indexed={}){
  const module=pythonImportAliases(source)[expression];if(!module)return [];
  const members=[...new Set(indexed[module]||prebuiltPythonMembers[module]||[])];
  const lower=prefix.toLowerCase();return members.filter(member=>member.toLowerCase().startsWith(lower)&&member.length>prefix.length).slice(0,5).map(member=>({word:`${expression}.${member}`,suffix:member.slice(prefix.length),score:9000,member:true}));
}

export async function inspectPythonModule(module){
  if(!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(module))throw new Error("Invalid Python module name");
  const script="import importlib,json,sys; print(json.dumps(sorted(n for n in dir(importlib.import_module(sys.argv[1])) if not n.startswith('_'))))";
  const {stdout}=await execFileAsync("python3",["-I","-c",script,module],{maxBuffer:2_000_000,timeout:15_000});
  const members=JSON.parse(stdout);if(!Array.isArray(members))throw new Error("Python returned an invalid module index");return members.slice(0,2000);
}
