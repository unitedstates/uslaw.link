#!/bin/sh
cd public/source-icons

# fetch
wget -qO usgpo.png http://www.gpo.gov/images/news-media/logo_5415.jpg
wget -qO house.png https://pbs.twimg.com/profile_images/86836564/ushousereps_400x400.jpg
wget -qO libraryofcongress.jpeg https://pbs.twimg.com/profile_images/463771973139447808/Gv1mSKiG.jpeg
wget -qO govtrack.png https://pbs.twimg.com/profile_images/3113926464/808a08bd97e3b46f66c342095a2847e8.png
wget -qO cornell_lii.png https://pbs.twimg.com/profile_images/489847044786253824/hfokfHCX_200x200.png
wget -qO courtlistener.png https://pbs.twimg.com/profile_images/487693186022641664/FWfyCie1.png

# resize
for img in `ls *.png *.jpeg`; do
    IMG2=$(echo $img | sed s/.jpeg/.png/);
    convert $img -geometry 150 /tmp/icon-$$ \
        && mv /tmp/icon-$$ $IMG2
    if [ $img != $IMG2 ]; then rm $img; fi
done

# update client-side icon list!
