uslaw.link
==========

[https://uslaw.link](https://uslaw.link) is a legal citation resolver. That means you can paste a citation to a legal document --- such as [40 U.S.C. § 11101(1)](https://uslaw.link/#q=40%20U.S.C.%20%C2%A7%2011101(1)), [118 Stat 3910](https://uslaw.link/citation/stat/118/3910), [Pub.L. 110-84](https://uslaw.link/citation/us-law/public/110/84), [5 CFR §531.610(f)](https://uslaw.link/#q=5%20CFR%20%C2%A7531.610(f)), and [75 Fed. Reg. 28404](https://uslaw.link/#q=75%20Fed.%20Reg.%2028404) --- and uslaw.link will provide some links for where you can read the law or court case.

The full set of citations that uslaw.link supports are:

* U.S. Code citations like [40 U.S.C. § 11101(1)](https://uslaw.link/#q=40%20U.S.C.%20%C2%A7%2011101(1)). uslaw.link provides links to the official U.S. Code website [uscode.house.gov](https://uscode.house.gov) and the [Cornell Legal Information Institute](https://www.law.cornell.edu/uscode/text) for the most recent code and to the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site for the most recent published edition of the U.S. Code.
* U.S. "public law" citations like [Pub.L. 110-84](https://uslaw.link/citation/us-law/public/110/84). uslaw.link provides links to the [Legisworks Historical Statutes at Large Data](https://github.com/unitedstates/legisworks-historical-statutes) for Congress 1-85 and to the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site for the 104th Congress forward, plus links to [GovTrack.us](https://www.govtrack.us) for their corresponding bills (93rd Congress forward).
* U.S. Statutes at Large citations like [118 Stat 3910](https://uslaw.link/citation/stat/118/3910). uslaw.link provides links to [Legisworks Historical Statutes at Large Data](https://github.com/unitedstates/legisworks-historical-statutes) for volumes 1-64 and to the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site for Statutes at Large volumes 65-125, plus links to [GovTrack.us](https://www.govtrack.us) for their corresponding bills (93rd Congress forward).
* Code of Federal Regulations citations like [5 CFR §531.610(f)](https://uslaw.link/#q=5%20CFR%20%C2%A7531.610(f)) and Federal Register citations like [75 Fed. Reg. 28404](https://uslaw.link/#q=75%20Fed.%20Reg.%2028404). uslaw.link provides links to the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site.
* Federal court cases like [410 U.S. 113](https://uslaw.link/#q=410%20U.S.%20113) and [214 F.3d 416](https://uslaw.link/#q=214%20F.3d%20416). uslaw.link provides links to [Court Listener](https://www.courtlistener.com).
* The United States Constitution like [U.S. CONST., art. VI, cl. 2](https://uslaw.link/#q=U.S.%20CONST.%2C%20art.%20VI%2C%20cl.%202). uslaw.link provides links to [Archives.gov](https://www.archives.gov/founding-docs/constitution-transcript) and the [Constitution Annotated](https://www.congress.gov/constitution-annotated) from the Library of Congress.
* District of Columbia laws like [DC Law 22-168](https://uslaw.link/#q=DC%20Law%2022-168) and DC Code sections like [DC Code 1-1161.01](https://uslaw.link/#q=DC%20Official%20Code%201-1161.01). uslaw.link provides links to [code.dccouncil.us](https://code.dccouncil.us/).
* Virginia code citations like [VA Code § 30-178](https://uslaw.link/#q=VA%20Code%20%C2%A7%2030-178). uslaw.link proides links to [Virginia Decoded](https://vacode.org).

In addition, when you paste certain types of citations, uslaw.link provides additional *parallel citations*, meaning other citations that refer to the same law or case. That's because laws and cases often appear in multiple publications, and each publication has a different citation.

* When you paste a Statutes at Large citation, the parallel Public Law citation and links are provided, and the originating U.S. Congress bill number and links to [GovTrack.us](https://www.govtrack.us) (93rd Congress forward) and the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site (103rd Congress forward) are provided. This uses [Legisworks Historical Statutes at Large Data](https://github.com/unitedstates/legisworks-historical-statutes) for volumes 1-64 and to the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site for Statutes at Large volumes 65-125.
* When you paste a Public Law citation, the parallel Statutes at Large citation and links are provided using the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) MODS metadata. Additionally, the originating U.S. Congress bill number and links to [GovTrack.us](https://www.govtrack.us) (93rd Congress forward) and the Government Publishing Office's [GovInfo.gov](https://govinfo.gov) site (103rd Congress forward) are provided, using GovTrack.us's public law database.

Additionally, titles for laws and cases are added and citations are disambiguated by querying:

* The Government Publishing Office's [GovInfo.gov](https://govinfo.gov) MODS metadata.
* The [Legisworks Historical Statutes at Large Data](https://github.com/unitedstates/legisworks-historical-statutes).
* [Court Listener](https://www.courtlistener.com).
* [uscode.house.gov](https://uscode.house.gov), to check whether a U.S. Code citation is valid.

Citation parsing is performed by the open source citation library at https://github.com/unitedstates/citation. 