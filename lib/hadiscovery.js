/**
 * Home Assistant discovery from the items seen so far: the CUL is a bridge device, every RF
 * address (`<protocol>/<address>`, or its map-file name) becomes its own device linked to the
 * bridge via `via_device`, with one sensor per scalar field. Devices announce themselves by
 * sending; device classes are derived from the field name. The scaffold (topics, availability,
 * origin) comes from mqtt-interfaces-core.
 */

import { availability, discoveryId, entity } from "mqtt-interfaces-core";

/** field name в†’ HA sensor attributes */
const FIELDS = {
  temperature: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    stat_cla: "measurement",
  },
  desired_temperature: { dev_cla: "temperature", unit_of_meas: "В°C" },
  measured_temperature: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    stat_cla: "measurement",
  },
  heater_temperature: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    stat_cla: "measurement",
  },
  comfort_temperature: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    ent_cat: "config",
  },
  eco_temperature: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    ent_cat: "config",
  },
  day_temp: { dev_cla: "temperature", unit_of_meas: "В°C", ent_cat: "config" },
  night_temp: { dev_cla: "temperature", unit_of_meas: "В°C", ent_cat: "config" },
  desired_temp: { dev_cla: "temperature", unit_of_meas: "В°C" },
  measured_temp: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    stat_cla: "measurement",
  },
  date: { dev_cla: "date" },
  measured_low: {
    dev_cla: "temperature",
    unit_of_meas: "В°C",
    stat_cla: "measurement",
  },
  humidity: { dev_cla: "humidity", unit_of_meas: "%", stat_cla: "measurement" },
  valve_position: { unit_of_meas: "%", ic: "mdi:valve" },
  actuator: { unit_of_meas: "%", ic: "mdi:valve" },
  rssi: {
    dev_cla: "signal_strength",
    unit_of_meas: "dBm",
    ent_cat: "diagnostic",
    stat_cla: "measurement",
  },
  battery: { ic: "mdi:battery", ent_cat: "diagnostic" },
  battery_state: { ic: "mdi:battery", ent_cat: "diagnostic" },
  battery_low: { dev_cla: "battery", ent_cat: "diagnostic" },
  low_temperature: {
    dev_cla: "problem",
    ent_cat: "diagnostic",
    ic: "mdi:thermometer-alert",
  },
  window_open: { dev_cla: "opening", ent_cat: "diagnostic" },
  window_sensor_error: { dev_cla: "problem", ent_cat: "diagnostic" },
  current: { ic: "mdi:flash", stat_cla: "measurement" },
  peak: { ic: "mdi:flash" },
  total: { ic: "mdi:counter", stat_cla: "total_increasing" },
  voltage: { dev_cla: "voltage", unit_of_meas: "V", stat_cla: "measurement" },
  power: { dev_cla: "power", unit_of_meas: "W", stat_cla: "measurement" },
  energy: {
    dev_cla: "energy",
    unit_of_meas: "kWh",
    stat_cla: "total_increasing",
  },
  frequency: {
    dev_cla: "frequency",
    unit_of_meas: "Hz",
    stat_cla: "measurement",
  },
  power_factor: { dev_cla: "power_factor", stat_cla: "measurement" },
  open: { dev_cla: "opening" },
  mode_str: { ic: "mdi:thermostat" },
};

const LABELS = {
  mode: "Operating mode",
  desired_temp: "Target temperature",
  measured_temp: "Current temperature",
  day_temp: "Day temperature",
  night_temp: "Night temperature",
  windowopen_temp: "Window-open temperature",
  lowtemp_offset: "Low-temperature offset",
  warnings: "Warnings",
  battery_low: "Low battery",
  low_temperature: "Low temperature",
  window_open: "Window open",
  window_sensor_error: "Window sensor error",
  actuator: "Valve position",
  rssi: "Signal strength",
  holiday1: "Holiday start",
  holiday2: "Holiday end",
  time: "Thermostat time",
  date: "Thermostat date",
};
const WEEKDAYS = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
function friendlyLabel(field) {
  if (LABELS[field]) return LABELS[field];
  const schedule = /^(mon|tue|wed|thu|fri|sat|sun)_(from|to)([12])$/.exec(
    field,
  );
  if (schedule)
    return `${WEEKDAYS[schedule[1]]} period ${schedule[3]} ${schedule[2] === "from" ? "starts" : "ends"}`;
  return field
    .replace(/_/g, " ")
    .replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

/** protocol в†’ HA device manufacturer / model */
const MODELS = {
  fs20: { mf: "ELV", mdl: "FuзЛh‘йм¶»§q«^tЛњМЊ]љXЩ\ИHЧHJHВ€ЫЫњЭњљYЩRYH\ШЫЭ™\ћRY
Э[›\]‹[YJNВ€ЫЫњЭYИH™]ИЩ]
ШњљYЩRYJNВ€›Ь€
ЫЫњЭЪ][K[YWHЩ€][\КHВ€YЛY
	ШњљYЩRYWЙЭZY›ЬЉЬ]][J][JK™]љXЩJ_X
NВ€Y€
[YKњ]КHВ€YЛY
	ШњљYЩRYWЙЭZY›ЬЉЬ]][J[YKњ]КK™]љXЩJ_X
NВ€B€B€›Ь€
ЫЫњЭYљ[љ][Ы€Щ€њМЊ]љXЩ\КHВ€YЛY
	ШњљYЩRYWЩњМЊЙФЭљ[™КYљ[љ][Ы‹Y™\ЬКKќХ\\ђШ\ЩJ
_X
NВ€B€™]\›€Л‹‹›™]ИЩ]
Л‹‹љYЧK›X\

Y
HO€YќУЭЩ\ђШ\ЩJ
JJWNВџB‚‹КЉ‚€
€Ь]HX›\ЪY][H[ќИ]И]љXЩH\ќ[™љY[€]љ[™ЧЬ›ЫЫKЭ[\\]\™X8Ў¤‚€
€]љ[™ЧЬ›ЫЫX
И[\\]\™XИHЪ[™ЫK\ЩYЫY[ќ][H
ќ[HX\YЬ€[€”МЊ]™[ќ
H\И›Э‚€
‹В™^Ьќќ[Э[Ы€Ь]][J][JHВ€ЫЫњЭHH][K›\Э[™^ЩЉ‹ИЉNВ€™]\›€H€ИИ]љXЩN€][KљY[€][HB€€И]љXЩN€][KњЫXЩJJKљY[€][KњЫXЩJH
ИJHNВџB‚‹КЉ‚€
€\[HЫШљ™XЭH[њ]€
€\[HЬЭљ[™ЯH[њ]›[YH[њЭ[ЩH[YHИЬXИ™Yљ^€
€\[HУX\Эљ[™ЛЭ[€
‹™]Z[Ћ€›ЫЫX[‹]ПО€Эљ[™Л]љXЩOО€Эљ[™ЯOџH[њ]љ][\И][\В€
€ЩY[€ЫИ\€
X›\ЪY[YH8Ў¤€\Э[YK]ШH[›X\Y›ЭШЫЫ‹ПY™\ЬП‹ПљY[
B€
€\[HШ›ЫЫX[џH[њ]љњЫЫ”^[ШYВ€
€\[HР\њ^OЫ[YN€Эљ[™ЛY™\ЬО€Эљ[™Л\OО€	ЬЭЪ]Ъ	Я	ЫYЪ	ЛЫ—Э[YOО€ќ[X™\џOџH[њ]™њМЊ]љXЩ\И^XЪ]”МЊXЭX]ЬњВ€
€™]\›њИР\њ^OЪY€Эљ[™Л]љXЩN€Шљ™XЭЫЫ\Ы™[ќО€Шљ™XЭ]Z[Xљ[]SZ[ЏО€ќ[X™\џOџB€
‹В™^Ьќќ[Э[Ы€\ШЫЭ™\ћS[Щ[
В€[YK€][\Л€њЫЫ”^[ШYИHќYK€њМЊ]љXЩ\ИHЧKџJHВ€ЛИ\ШЫЭ™\ћHQИ\™H™YЪ\ЭћHЩ^\И[€ЫYH\ЬЪ\Э[ќ€™\Щ\ќ™HZ\€ЬљYЪ[[Ь[[™ИЫВ€ЛИ^\Э[™И]љXЩH[™[ќ]H™YЪ\ЭћH[ќљY\ИЫЫќ[ќYHИX]ЪYќ\€\ЬY[™Л‚€ЫЫњЭњљYЩRYH\ШЫЭ™\ћRY
Э[›\]‹[YJNВ€ЫЫњЭ]љXЩ\ИH™]ИX\

NВ€›Ь€
ЫЫњЭЪ][KИ[]Л]љXЩN€X™[WHЩ€][\КHВ€Y€
VИњЭљ[™И‹›ќ[X™\€‹›ЫЫX[€—Kљ[ЫY\К\[Щ€[
JHВ€ЫЫќ[ќYNВ€B€ЫЫњЭИ]љXЩKљY[HHЬ]][J][JNВ€ЫЫњЭ›ЭШЫЫHЭљ[™К
]И][JKњЬ]
‹ИЉVМJKќУЭЩ\ђШ\ЩJ
NВ€ЫЫњЭ]љXЩRЩ^HH]љXЩKќУЭЩ\ђШ\ЩJ
NВ€Y€
Y]љXЩ\Лљ\К]љXЩRЩ^JJHВ€ЫЫњЭ]Ф\ќИH
]И][JKњЬ]
‹ИЉNВ€]љXЩ\ЛњЩ]
]љXЩRЩ^KВ€Y€	ШњљYЩRYWЙЭZY›ЬЉ]љXЩJ_X€][P\ЩN€]љXЩK€›ЭШЫЫ€]Ф\ќЦМKќУЭЩ\ђШ\ЩJ
K€Y™\ЬО€]Ф\ќЦМWK€]љXЩN€В€[YN€]љXЩK€љXWЩ]љXЩN€њљYЩRY€‹‹Љ]И	‰€]Ф\ќЦМWH	‰€ИЫЋ€]Ф\ќЦМWHJK€‹‹ЉSСSЦЬ›ЭШЫЫHИY€›ЭШЫЫќХ\\ђШ\ЩJ
HJK€ЛИ™\Щ\ќ™HH’Э\ЩKXЫЩHY[ќYљY\€\ЩYћHX\›Y\€™[X\Щ\ИИ]XЪВ€ЛИ^\Э[™И\›[ЬЭ]]љXЩ\И[€ЫYH\ЬЪ\Э[ќ‚€‹‹Љ›ЭШЫЫOOH™љ€	‰€ИYО€Ь]Ф\ќЦМWWHJK€ЛИHЭ[\њЩ\€[Y\ИH]љXЩH\H›Ь€ЫЫYH›ЭШЫЫИ
ММФММ‹‹ЉB€‹‹ЉX™[	‰€ИY€Эљ[™КX™[
HJK€K€ЫЫ\Ы™[ќО€ЯK€JNВ€B€ЫЫњЭ]€H]љXЩ\Л™Щ]
]љXЩRЩ^JNВ€Y€
љY[OOH›Ы›[™H€	‰€]љXЩHOOH][JHВ€ЛИЩ™›[™H]XЭ[Ы€][N€\‹Y]љXЩH]Z[Xљ[]H
њљYЩHЫЫ›™XЭYS‘]љXЩHЫ›[™K€ЛИ]ќWЫ[ЩH	Ш[	ИЫЫY\Ињ›ЫHHЫЬ™JK›ЭHЩ[њЫЬ‚€]‹]Z[Xљ[]HHВ€‹‹]Z[Xљ[]J[YJK€В€€	Ы[Y_KЬЭ]\ЛЙЪ][_X€ЛИH[\]HЩ€[€[ќћHЩ€[€]Z[Xљ[]H
›\Э
€\И[ЭИ]ќWЭ€ЛИ^[™ИИ]Z[Xљ[]WЭ[\]XЪXЪЫYH\ЬЪ\Э[ќ	ЬИШЪ[XH›Ь€ЭXЪ[‚€ЛИ[ќћHЩ\И›Э[ЭИH[™]™Yќ\Щ\ИHЪЫH]љXЩH^[ШYЭ™\€]€ЛИ
ЫЬ™HЊMKЊЉB€[Э€њЫЫ”^[ШYВ€ИћЮИ	ЫЫ›[™IИY€[YWЪњЫЫ‹ќ[[ЩH	ЫЩ™›[™IИ_H‚€€ћЮИ	ЫЫ›[™IИY€[YHOH	МIИ[ЩH	ЫЩ™›[™IИ_H‹€K€NВ€ЫЫќ[ќYNВ€B€ЛИ’ћ]HљY[И\™H[њ]ИИHЫЫXљ[™Y[\\]\™KЭ[YKЩ]H[Y\Л›Э\ЩYќ[[ќ]Y\Л‚€Y€
€›ЭШЫЫOOH™љ€	‰‚€В€›YX\Э\™YЫЭИ‹€›YX\Э\™YЪYЪ‹€љЭ\€‹€›Z[ќ]H‹€™^H‹€›[Ыќ‹€ћYX\€‹€Kљ[ЫY\КљY[
B€
B€ЫЫќ[ќYNВ€ЫЫњЭИ[ќШШ]€Ш]YЫЬћKXО€XЫЫ‹‹‹™^HHH’QSЦЩљY[HЯNВ€ЫЫњЭљ[\ћHH\[Щ€[OOH›ЫЫX[€ЋВ€]‹ЫЫ\Ы™[ќЦЭZY›ЬЉљY[
WHH[ќ]JВ€Y€]‹љY€[YK€][K€ZY€ZY›ЬЉљY[
K€]›Ь›N€љ[\ћHИљ[\ћWЬЩ[њЫЬ€€€њЩ[њЫЬ€‹€X™[€њљY[™SX™[
љY[
K€XЫЫ‹€Ш]YЫЬћK€њЫЫ”^[ШYЛ€^N‚€љY[OOH›[ЩH‚€ИВ€‹‹™^K€[Э€њЫЫ”^[ШYВ€ИћЮИ	Р]]ЫX]XЙИY€[YWЪњЫЫ‹ќ[OH	РUUЙИ[ЩH	УX[ќX[	ИY€[YWЪњЫЫ‹ќ[OH	УPS•IИ[ЩH[YWЪњЫЫ‹ќ[_H‚€€ћЮИ	Р]]ЫX]XЙИY€[YHOH	РUUЙИ[ЩH	УX[ќX[	ИY€[YHOH	УPS•IИ[ЩH[YH_H‹€B€€љ[\ћB€ИВ€‹‹™^K€ЛИ›ЫЫX[њИ
]\ћSЭЛЬ[‹‹‹ЉH\Иљ[\ћHЩ[њЫЬњВ€[Э€њЫЫ”^[ШYВ€ИћЮИ	УУ‰ИY€[YWЪњЫЫ‹ќ[[ЩH	УС‘‰И_H‚€€ћЮИ	УУ‰ИY€[YHOH	ЭќYIИ[ЩH	УС‘‰И_H‹€B€€^K€JNВ€B‚€›Ь€
ЫЫњЭ]€Щ€]љXЩ\Лќ[Y\К
JHВ€Y€
]‹њ›ЭШЫЫOOH™љ€Y]‹ЫЫ\Ы™[ќЛ›YX\Э\™YЭ[\
HВ€ЫЫќ[ќYNВ€B€ЫЫњЭ\ЩHH	Ы[Y_KЬЭ]\ЛЙЩ]‹љ][P\Щ_XВ€]‹ЫЫ\Ы™[ќЛЫ[X]HHВ€€Ы[X]H‹€[љ\WЪY€	Щ]‹љYWШЫ[X]X€[YN€•\›[ЬЭ]‹€Э\њ—Э[\Э€]‹ЫЫ\Ы™[ќЛ›YX\Э\™YЭ[\њЭ]Э€‹‹ЉњЫЫ”^[ШYИ	‰€ИЭ\њ—Э[\Э€ћЮИ[YWЪњЫЫ‹ќ[_H€JK€[\ЬЭ]Э€]‹ЫЫ\Ы™[ќЛ™\Ъ\™YЭ[\ЛњЭ]Э	Ш\Щ_KЩ\Ъ\™YЭ[\€‹‹ЉњЫЫ”^[ШYИ	‰€И[\ЬЭ]Э€ћЮИ[YWЪњЫЫ‹ќ[_H€JK€[\ШЫYЭ€	Ы[Y_KЬЩ]ЩљЙЩ]‹Y™\ЬЯKЩ\Ъ\™Y][\€[ЩWЬЭ]Э€]‹ЫЫ\Ы™[ќЛ›[ЩOЛњЭ]Э	Ш\Щ_KЫ[ЩX€[ЩWЬЭ]Э€њЫЫ”^[ШYВ€ИћЮИ	Ш]]ЙИY€[YWЪњЫЫ‹ќ[OH	РUUЙИ[ЩH	ЪX]	И_H‚€€ћЮИ	Ш]]ЙИY€[YHOH	РUUЙИ[ЩH	ЪX]	И_H‹€[ЩWШЫYЭ€	Ы[Y_KЬЩ]ЩљЙЩ]‹Y™\ЬЯKЫ[ЩX€[ЩWШЫYЭ€ћЮИ	РUUЙИY€[YHOH	Ш]]ЙИ[ЩH	УPS•IИ_H‹€XЭЭ€]‹ЫЫ\Ы™[ќЛXЭX]ЬЏЛњЭ]Э	Ш\Щ_KШXЭX]Ь€XЭЭ€њЫЫ”^[ШYВ€ИћЮИ	ЪX][™ЙИY€[YWЪњЫЫ‹ќ[›Ш]

H€L[ЩH	ЪYIИ_H‚€€ћЮИ	ЪX][™ЙИY€[YH›Ш]

H€L[ЩH	ЪYIИ_H‹€[Щ\О€И]]И‹љX]—K€[\Э[љ]€ђИ‹€[љ]X[€M‹€Z[—Э[\€L€X^Э[\€М€™XЪ\Ъ[ЫЋ€ЌK€NВ€]‹ЫЫ\Ы™[ќЛњЮ[ЧЭ[YHHВ€€ќ]Ы€‹€[љ\WЪY€	Щ]‹љYWЬЮ[ЧЭ[YX€[YN€”Ю[И[YH‹€ЫYЭ€	Ы[Y_KЬЩ]ЩљЙЩ]‹Y™\ЬЯKЬЮ[Л][YX€NВ€B‚€›Ь€
ЫЫњЭYљ[љ][Ы€Щ€њМЊ]љXЩ\КHВ€ЫЫњЭY™\ЬИHЭљ[™КYљ[љ][ЫЏЛY™\ЬИ€ЉB€ќљ[J
B€ќХ\\ђШ\ЩJ
NВ€ЫЫњЭX™[HЭљ[™КYљ[љ][ЫЏЛ›[YH€ЉKќљ[J
NВ€ЫЫњЭ\HHЭљ[™КYљ[љ][ЫЏЛќ\HњЭЪ]ЪЉKќУЭЩ\ђШ\ЩJ
NВ€Y€
€[X™[€KЧ–МNPKQ—^НџIЛќ\Э
Y™\ЬКH€VИњЭЪ]Ъ‹›YЪ—Kљ[ЫY\К\JB€
HВ€ЫЫќ[ќYNВ€B€ЫЫњЭYH	ШњљYЩRYWЩњМЊЙШY™\ЬЯXВ€ЫЫњЭЬXИH	Ы[Y_KЬЩ]ЩњМЊЙШY™\ЬЯXВ€ЫЫњЭЫЫ\Ы™[ќHВ€€\K€[љ\WЪY€	ЪYWШЫЫќ›Ы€[YN€ќ[€ЫYЭ€ЬXЛ€Э]Э€	Ы[Y_KЬЭ]\ЛЩњМЊЙШY™\ЬЯKЬЭ]X€Ь€ќYK€‹‹ЉњЫЫ”^[ШYИ	‰€В€Э]Э€ћЮИ	УУ‰ИY€[YWЪњЫЫ‹ќ[[ЩH	УС‘‰И_H‹€JK€‹‹ЉZњЫЫ”^[ШYИ	‰€В€Э]Э€ћЮИ	УУ‰ИY€[YHOH	ЭќYIИ[ЩH	УС‘‰И_H‹€JK€NВ€Y€
\HOOH›YЪЉHВ€ЫЫ\Ы™[ќњљWШЫYЭHЬXОВ€ЫЫ\Ы™[ќњљWЬШЫHLВ€B€]љXЩ\ЛњЩ]
њМЊЙШY™\ЬЯXВ€Y€]љXЩN€В€[YN€X™[€љXWЩ]љXЩN€њљYЩRY€ЫЋ€Y™\ЬЛ€‹‹“SСSЛ™њМЊ€K€ЫЫ\Ы™[ќО€В€ЫЫќ›Ы€ЫЫ\Ы™[ќ€‹‹“Шљ™XЭ™њ›ЫQ[ќљY\К€\њ^K™њ›ЫJИ[™Э€HK
Л[™^
HO€В€ЫЫњЭЫЭH[™^
ИNВ€ЫЫњЭљY[H[™^OOHИ›Ы—Э[YH€€[Y\—ЙЬЫЭXВ€™]\›€В€[Y\—ЙЬЫЭWЩ\][Ы€В€€›ќ[X™\€‹€[љ\WЪY€	ЪYWЙЩљY[X€[YN€[Y\€	ЬЫЭH\][Ы€Э]Э€	Ы[Y_KЬЭ]\ЛЩњМЊЙШY™\ЬЯKЙЩљY[X€‹‹ЉњЫЫ”^[ШYИ	‰€ИЭ]Э€ћЮИ[YWЪњЫЫ‹ќ[_H€JK€ЫYЭ€	ЭЬXЯKЙЩљY[X€Ь€ќYK€Z[Ћ€€X^€MWМНЊ€Э\€ЊЌK€[љ]ЫЩ—ЫYX\О€њИ‹€K€NВ€JK€
K€‹‹“Шљ™XЭ™њ›ЫQ[ќљY\К€\њ^K™њ›ЫJИ[™Э€HK
Л[™^
HO€В€ЫЫњЭЫЭH[™^
ИNВ€™]\›€В€[Y\—ЙЬЫЭWШќ]Ы€В€€ќ]Ы€‹€[љ\WЪY€	ЪYWЫЫ—Щ›Ь—Э[Y\—ЙЬЫЭX€[YN€\›€Ы€›Ь€[Y\€	ЬЫЭX€ЫYЭ€	ЭЬXЯKЫЫ‹Y›Ь‹][Y\‹ЙЬЫЭX€ЬњО€”‘TФИ‹€K€NВ€JK€
K€K€JNВ€B‚€ЫЫњЭњљYЩHHВ€Y€њљYЩRY€]љXЩN€ИYЋ€ђќ\ЭШ\™H‹Y€ђХS€K€]Z[Xљ[]SZ[Ћ€K€ЫЫ\Ы™[ќО€В€ЫЫ›™XЭY€[ќ]JВ€Y€њљYЩRY€[YK€][N€ЫЫ›™XЭY‹€ZY€ЫЫ›™XЭY‹€]›Ь›N€љ[\ћWЬЩ[њЫЬ€‹€X™[€ђЫЫ›™XЭY‹€Ш]YЫЬћN€™XYЫ›ЬЭXИ‹€^N€В€Э]Э€	Ы[Y_KШЫЫ›™XЭY€[Э€ћЮИ	УУ‰ИY€
[YH[ќ

JHЏH€[ЩH	УС‘‰И_H‹€]—ШЫN€ЫЫ›™XЭ]љ]H‹€K€JK€K€NВ€™]\›€ШњљYЩK‹‹™]љXЩ\Лќ[Y\К
WNВџB