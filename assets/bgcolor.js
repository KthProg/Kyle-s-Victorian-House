//

// Copyright 2001 by www.CodeBelly.com
// Please do *not* remove this notice.

var backImage = new Array(); // don't change this

// Enter the image filenames you wish to use.
// Follow the pattern to use more images.  The
// number in the brackets [] is the number you
// will use in the function call to pick each
// image.

// Note how backImage[3] = "" -- which would
// set the page to *no* background image.

// backImage[0] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/643wv8ww2fim9[1].jpg";
// backImage[1] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/631sxa70dj9st[1].jpg";
// backImage[2] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/2117hw493laltf1.jpg";
// backImage[3] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/087141a3.jpg";
// backImage[4] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/bg22[1].bmp";
// backImage[5] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/blue.bmp";
// backImage[6] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/navyblue.bmp";
// backImage[7] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/yellow.bmp";
// backImage[8] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/lime.bmp";
// backImage[9] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/green.bmp";
// backImage[10] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/orange.bmp";
// backImage[11] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/pink.bmp ";
// backImage[12] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/purple.bmp";
// backImage[13] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/gray.bmp";
// backImage[14] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/darkgray.bmp";
// backImage[15] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/black.bmp";
// backImage[16] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/white.bmp";
// backImage[17] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/cyan.bmp";
// backImage[18] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/brown.bmp";
// backImage[19] = "https://web.archive.org/web/20130815075907/http://7thcolumn.net/images/red.bmp";

backImage[0] = "/images/bg22[1].jpg";
backImage[1] = "/images/bg22[1].jpg";
backImage[2] = "/images/bg22[1].jpg";
backImage[3] = "/images/bg22[1].jpg";
backImage[4] = "/images/bg22[1].jpg";
backImage[5] = "blue";
backImage[6] = "navy";
backImage[7] = "lime";
backImage[8] = "green";
backImage[9] = "brown";
backImage[10] = "red";
backImage[11] = "orange ";
backImage[12] = "yellow";
backImage[13] = "pink";
backImage[14] = "purple";
backImage[15] = "cyan";
backImage[16] = "black";
backImage[17] = "darkgray";
backImage[18] = "gray";
backImage[19] = "white";

// Do not edit below this line.
//-----------------------------

function changeBGImage(whichImage) {
    if (top.document.body) {
        var topBody = top.document.body;
        var colorOrImage = backImage[whichImage];
        var isImage = String(colorOrImage).charAt(0) === '/';
        if(isImage){
            topBody.style.backgroundColor = 'unset';
            topBody.style.backgroundImage = colorOrImage;
        } else {
            topBody.style.backgroundImage = 'unset';
            topBody.style.backgroundColor = colorOrImage;
        }
    }
}