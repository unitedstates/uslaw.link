var Citation = require('./citation');

// us_bill citator stub and extending linkers for citations to bills
var us_bill_type_display = { hr: "H.R.", s: "S.", hres: "H.Res.", sres: "S.Res.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res." };
function ordinal(number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = Math.abs(number) % 100;
  return number + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}
Citation.types.us_bill = {
  id: function(cite) {
    return "us_bill/" + cite.congress + "/" + cite.bill_type + "/" + cite.number;
  },
  name: "U.S. Legislation",
  canonical: function(cite) {
    return (us_bill_type_display[cite.bill_type] || cite.bill_type.toUpperCase()) + " " + cite.number + " (" + ordinal(cite.congress) + " Congress)";
  }
};

Citation.links.gpo.citations.us_bill = function(cite) {
  if (cite.congress < 103) return null;
  return {
    pdf: "https://www.govinfo.gov/link/bills/" + cite.congress + "/" + cite.bill_type + "/" + cite.number
  };
}

Citation.links.govtrack.citations.us_bill = function(cite) {
  if (cite.congress < 93 && !cite.is_enacted) return null;
  return {
    landing: "https://www.govtrack.us/congress/bills/" + cite.congress + "/" + cite.bill_type + cite.number,
    html: "https://www.govtrack.us/congress/bills/" + cite.congress + "/" + cite.bill_type + cite.number + "/text"
  }
};
