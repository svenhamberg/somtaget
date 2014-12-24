function validateForm() {
    var name = document.forms["konferensAnmalan"]["name"].value;
    var business = document.forms["konferensAnmalan"]["business"].value;
    var email = document.forms["konferensAnmalan"]["email"].value;
    console.log('name:'+name,'business:'+business,'email:'+email);
    if (name == null || name == "" || business == null || business == "" || email == null || email == "") {
        alert("Anmälan ej fullständig. Något eller några av dessa fält sakanas:\n\n - Namn\n - Företag\n - E-post");
        return false;
    }
}

function validateFormMobile() {
    var name = document.forms["konferensAnmalanMobile"]["name"].value;
    var business = document.forms["konferensAnmalanMobile"]["business"].value;
    var email = document.forms["konferensAnmalanMobile"]["email"].value;
    console.log('name:'+name,'business:'+business,'email:'+email);
    if (name == null || name == "" || business == null || business == "" || email == null || email == "") {
        alert("Anmälan ej fullständig. Något eller några av dessa fält sakanas:\n\n - Namn\n - Företag\n - E-post");
        return false;
    }
}